/**
 * yt-dlp and spotDL subprocess wrapper
 * Handles video/audio downloads from YouTube, Instagram, TikTok, Twitter, etc.
 * Uses spotDL for Spotify URLs only.
 */

const { spawn } = require('child_process');
const path = require('path');

// Map URL patterns to site identifiers for badges and logic
const SITE_PATTERNS = [
  { pattern: /youtube\.com|youtu\.be/i, site: 'youtube' },
  { pattern: /instagram\.com/i, site: 'instagram' },
  { pattern: /tiktok\.com|vm\.tiktok/i, site: 'tiktok' },
  { pattern: /(?:twitter|x)\.com/i, site: 'twitter' },
  { pattern: /facebook\.com|fb\.watch|fb\.com/i, site: 'facebook' },
  { pattern: /soundcloud\.com/i, site: 'soundcloud' },
  { pattern: /spotify\.com/i, site: 'spotify' },
];

/**
 * Detect which site a URL belongs to
 * @param {string} url - The media URL
 * @returns {string} - Site identifier (youtube, instagram, tiktok, etc.)
 */
function detectSite(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  for (const { pattern, site } of SITE_PATTERNS) {
    if (pattern.test(url)) return site;
  }
  return 'unknown';
}

/**
 * Normalize Spotify URL for oEmbed (requires full https://open.spotify.com/...)
 */
function normalizeSpotifyUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://open.spotify.com/')) return url;
  if (url.startsWith('http://open.spotify.com/')) return url.replace('http://', 'https://');
  if (url.startsWith('open.spotify.com/')) return 'https://' + url;
  if (url.includes('spotify.com/')) {
    const match = url.match(/spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/);
    if (match) return `https://open.spotify.com/${match[1]}/${match[2]}`;
  }
  return url;
}

/**
 * Fetch video/audio metadata via yt-dlp --dump-json
 * For Spotify, returns basic info (spotDL doesn't support metadata-only)
 * @param {string} url - Media URL
 * @param {string} downloadDir - Directory for temp files
 * @returns {Promise<object>} - { title, thumbnail, duration, uploader, site, isPlaylist, hasSubtitles }
 */
async function getInfo(url, downloadDir) {
  const site = detectSite(url);

  // Spotify: fetch metadata via oEmbed API (no auth required)
  if (site === 'spotify') {
    const isPlaylist = /spotify\.com\/(playlist|album)/i.test(url);
    const normalizedUrl = normalizeSpotifyUrl(url);
    try {
      const oembedUrl = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(normalizedUrl);
      console.log('[Spotify oEmbed] Fetching:', oembedUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await res.text();
      console.log('[Spotify oEmbed] Status:', res.status);

      if (!res.ok) {
        console.error('[Spotify oEmbed] Failed:', res.status, text.slice(0, 300));
        throw new Error(`oEmbed returned ${res.status}`);
      }

      if (text) {
        const data = JSON.parse(text);
        if (data && (data.title || data.thumbnail_url)) {
          return {
            title: data.title || 'Spotify content',
            thumbnail: data.thumbnail_url || null,
            duration: null,
            uploader: data.author_name || data.provider_name || null,
            site: 'spotify',
            isPlaylist,
            hasSubtitles: false,
          };
        }
      }
    } catch (e) {
      console.error('[Spotify oEmbed]', e.message);
    }
    return {
      title: 'Spotify content',
      thumbnail: null,
      duration: null,
      uploader: null,
      site: 'spotify',
      isPlaylist,
      hasSubtitles: false,
    };
  }

  // Use yt-dlp for all other sites
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      url,
    ];

    const proc = spawn('yt-dlp', args, {
      cwd: path.resolve(downloadDir),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || 'Failed to fetch info'));
      }

      try {
        // Handle playlists: yt-dlp outputs one JSON object per line for playlists
        const lines = stdout.trim().split('\n').filter(Boolean);
        const first = lines[0] ? JSON.parse(lines[0]) : {};
        const isPlaylist = first._type === 'playlist' || lines.length > 1;
        const entry = isPlaylist && first.entries?.[0] ? first.entries[0] : first;
        const info = entry || first;

        resolve({
          title: info.title || 'Unknown',
          thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null,
          duration: info.duration || null,
          uploader: info.uploader || info.creator || info.channel || null,
          site,
          isPlaylist,
          hasSubtitles: site === 'youtube' && !!(info.subtitles && Object.keys(info.subtitles).length > 0) ||
            !!(info.automatic_captions && Object.keys(info.automatic_captions).length > 0),
          approxSize: info.filesize_approx || info.filesize || null,
        });
      } catch (err) {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * Build yt-dlp format string based on quality
 * @param {string} quality - 'best' | '1440' | '1080' | '720' | '360'
 * @param {string} format - 'mp4' | 'mp3'
 * @returns {string} - yt-dlp format selector
 */
function buildFormatString(quality, format) {
  if (format === 'mp3') {
    return 'bestaudio/best';
  }
  switch (quality) {
    case '1440': return 'bestvideo[height<=1440]+bestaudio/best[height<=1440]';
    case '1080': return 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
    case '720': return 'bestvideo[height<=720]+bestaudio/best[height<=720]';
    case '360': return 'bestvideo[height<=360]+bestaudio/best[height<=360]';
    default: return 'bestvideo+bestaudio/best';
  }
}

/**
 * Sanitize filename template - only allow safe yt-dlp placeholders
 */
const SAFE_TEMPLATE = /^[a-zA-Z0-9%(.)._\-\s]+$/;
function sanitizeTemplate(template) {
  if (!template || typeof template !== 'string') return null;
  const t = template.trim();
  return SAFE_TEMPLATE.test(t) ? t : null;
}

/**
 * Download media using yt-dlp or spotDL
 * @param {object} options - Download options
 * @param {string} options.url - Media URL
 * @param {string} options.format - 'mp4' | 'mp3'
 * @param {string} options.quality - 'best' | '1440' | '1080' | '720' | '360'
 * @param {string} options.audioBitrate - '128' | '192' | '256' | '320' (MP3)
 * @param {string} options.filenameTemplate - yt-dlp output template
 * @param {string} options.subtitleLangs - Comma-separated langs, e.g. 'en,es'
 * @param {boolean} options.isPlaylist - Download full playlist
 * @param {boolean} options.subtitles - Include subtitles (YouTube only)
 * @param {boolean} options.removeWatermark - Remove TikTok watermark
 * @param {string} options.downloadDir - Output directory
 * @param {function} options.onProgress - Callback(percent) for progress updates
 * @returns {Promise<string[]>} - Array of downloaded filenames
 */
async function download({
  url,
  format,
  quality,
  audioBitrate,
  filenameTemplate,
  subtitleLangs,
  isPlaylist,
  subtitles,
  removeWatermark,
  downloadDir,
  spotifyYoutubeUrl,
  embedSubtitles,
  startTime,
  endTime,
  limitRate,
  onProgress,
}) {
  const site = detectSite(url);

  if (site === 'spotify') {
    return downloadSpotifyViaYoutube({
      url,
      format,
      quality,
      audioBitrate,
      filenameTemplate,
      subtitleLangs,
      isPlaylist,
      spotifyYoutubeUrl,
      downloadDir,
      embedSubtitles,
      startTime,
      endTime,
      limitRate,
      onProgress,
    });
  }

  return downloadWithYtDlp({
    url,
    format,
    quality,
    audioBitrate,
    filenameTemplate,
    subtitleLangs,
    isPlaylist,
    subtitles,
    removeWatermark,
    downloadDir,
    site,
    embedSubtitles,
    startTime,
    endTime,
    limitRate,
    onProgress,
  });
}

/**
 * Spotify fallback: resolve track via oEmbed, then download best match from YouTube using yt-dlp.
 * NOTE: Playlists are NOT supported in this fallback mode.
 */
async function downloadSpotifyViaYoutube({
  url,
  format,
  quality,
  audioBitrate,
  filenameTemplate,
  subtitleLangs,
  isPlaylist,
  spotifyYoutubeUrl,
  downloadDir,
  embedSubtitles,
  startTime,
  endTime,
  limitRate,
  onProgress,
}) {
  if (isPlaylist) {
    throw new Error('Spotify playlists are not supported in fallback mode. Use individual track URLs instead.');
  }

   // If user picked a specific YouTube URL in the UI, use it directly.
   if (spotifyYoutubeUrl) {
     return downloadWithYtDlp({
       url: spotifyYoutubeUrl,
       format,
       quality,
       audioBitrate,
       filenameTemplate,
       subtitleLangs,
       isPlaylist: false,
       subtitles: false,
       removeWatermark: false,
       downloadDir,
       site: 'youtube',
       embedSubtitles,
       startTime,
       endTime,
       limitRate,
       onProgress,
     });
   }

  let query = '';
  let spotifyTitle = '';
  let spotifyArtists = [];
  let spotifyDurationSec = null;

  // Try rich metadata from Spotify Web API (if client credentials are configured)
  try {
    const meta = await getSpotifyTrackMetadata(url);
    if (meta) {
      spotifyTitle = meta.title || '';
      spotifyArtists = meta.artists || [];
      spotifyDurationSec = meta.durationSec || null;
      if (!query && meta.title) {
        query = meta.artists?.length ? `${meta.title} ${meta.artists.join(' ')}` : meta.title;
      }
    }
  } catch (_) {
    // Ignore and fall back to oEmbed
  }

  // Fallback to oEmbed info if needed
  let oembedInfo = null;
  try {
    oembedInfo = await getInfo(url, downloadDir);
    if (!query && oembedInfo && oembedInfo.title) {
      query = oembedInfo.uploader ? `${oembedInfo.title} ${oembedInfo.uploader}` : oembedInfo.title;
    }
  } catch (_) {
    // fall through – we will just search by normalized URL
  }

  // If we have a reasonable query, do a multi-result YouTube search and pick the best match
  if (query) {
    try {
      const bestUrl = await findBestYoutubeMatchForSpotify({
        query,
        spotifyTitle: spotifyTitle || (oembedInfo && oembedInfo.title) || '',
        spotifyArtists: spotifyArtists.length ? spotifyArtists : (oembedInfo && oembedInfo.uploader ? [oembedInfo.uploader] : []),
        durationSec: spotifyDurationSec,
        downloadDir,
      });
      if (bestUrl) {
        return downloadWithYtDlp({
          url: bestUrl,
          format,
          quality,
          audioBitrate,
          filenameTemplate,
          subtitleLangs,
          isPlaylist: false,
          subtitles: false,
          removeWatermark: false,
          downloadDir,
          site: 'youtube',
          onProgress,
        });
      }
    } catch (e) {
      console.error('[Spotify fallback] YouTube search failed, falling back to ytsearch1:', e.message);
    }
  }

  // Fallback: simple one-shot search with whatever we have (may be less accurate)
  const normalizedUrl = normalizeSpotifyUrl(url);
  const search = query ? `ytsearch1:${query}` : normalizedUrl;
  return downloadWithYtDlp({
    url: search,
    format,
    quality,
    audioBitrate,
    filenameTemplate,
    subtitleLangs,
    isPlaylist: false,
    subtitles: false,
    removeWatermark: false,
    downloadDir,
    site: 'youtube',
    embedSubtitles,
    startTime,
    endTime,
    limitRate,
    onProgress,
  });
}

/**
 * Perform a YouTube search via yt-dlp and pick the best match for a Spotify track.
 * Uses text heuristics to avoid live/remix/cover versions when possible.
 */
async function findBestYoutubeMatchForSpotify({ query, spotifyTitle, spotifyArtists, durationSec, downloadDir }) {
  const searchQuery = `ytsearch10:${query}`;
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-download', searchQuery];
    const proc = spawn('yt-dlp', args, {
      cwd: path.resolve(downloadDir),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || 'yt-dlp search failed'));
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const results = lines.map((line) => JSON.parse(line));
        if (!results.length) return resolve(null);

        const artistCombined = (spotifyArtists || []).join(' ');
        const artistNorm = normalizeForMatch(artistCombined);
        const hasStrongArtistCandidate =
          !!artistNorm &&
          results.some((r) => {
            const ytTitle = normalizeForMatch(r.title || '');
            const ytChannel = normalizeForMatch(r.uploader || r.channel || '');
            return ytTitle.includes(artistNorm) || ytChannel.includes(artistNorm);
          });

        const best = scoreBestYoutubeResult(
          results,
          spotifyTitle || '',
          artistCombined,
          durationSec || null,
          hasStrongArtistCandidate,
        );
        resolve(best ? best.webpage_url || best.url : null);
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * Return a list of YouTube candidates for a Spotify track so the user can choose manually.
 */
async function getSpotifyCandidates(url, downloadDir) {
  const site = detectSite(url);
  if (site !== 'spotify') return [];

  let query = '';

  try {
    const meta = await getSpotifyTrackMetadata(url);
    if (meta && meta.title) {
      query = meta.artists?.length ? `${meta.title} ${meta.artists.join(' ')}` : meta.title;
    }
  } catch (_) {}

  if (!query) {
    try {
      const info = await getInfo(url, downloadDir);
      if (info && info.title) {
        query = info.uploader ? `${info.title} ${info.uploader}` : info.title;
      }
    } catch (_) {}
  }

  const normalizedUrl = normalizeSpotifyUrl(url);
  const searchQuery = query ? `ytsearch10:${query}` : normalizedUrl;

  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-download', searchQuery];
    const proc = spawn('yt-dlp', args, {
      cwd: path.resolve(downloadDir),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const results = lines.map((line) => JSON.parse(line));
        const candidates = results.map((r) => ({
          url: r.webpage_url || r.url,
          title: r.title || '',
          uploader: r.uploader || r.channel || '',
          duration: r.duration || null,
        }));
        if (candidates.length > 0) {
          // Even if yt-dlp exited with non-zero due to warnings, return whatever we parsed.
          if (code !== 0) {
            console.warn('[Spotify candidates] yt-dlp exited with code', code, 'but parsed', candidates.length, 'results.');
          }
          resolve(candidates);
        } else if (code !== 0) {
          reject(new Error(stderr || 'yt-dlp search failed'));
        } else {
          resolve([]);
        }
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

function normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\[\]\(\)\-_,\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreBestYoutubeResult(results, spotifyTitle, spotifyArtist, spotifyDurationSec, preferArtistStrict) {
  const titleNorm = normalizeForMatch(spotifyTitle);
  const artistNorm = normalizeForMatch(spotifyArtist);
  const titleTokens = titleNorm.split(' ').filter(Boolean);

  const badWords = ['live', 'remix', 'slowed', 'speed up', 'sped up', '8d', 'cover', 'edit', 'version'];

  let best = null;
  let bestScore = -Infinity;

  for (const r of results) {
    const ytTitle = normalizeForMatch(r.title || '');
    const ytChannel = normalizeForMatch(r.uploader || r.channel || '');

    let score = 0;

    // Reward title token overlap
    for (const t of titleTokens) {
      if (ytTitle.includes(t)) score += 2;
    }

    // Reward artist matches in title or channel
    if (artistNorm) {
      if (ytTitle.includes(artistNorm)) score += 4;
      if (ytChannel.includes(artistNorm)) score += 6;
    }

    // Penalize bad words if they are not in the Spotify title
    for (const w of badWords) {
      const inYtTitle = ytTitle.includes(w);
      const inSpotifyTitle = titleNorm.includes(w);
      if (inYtTitle && !inSpotifyTitle) score -= 5;
    }

    // Prefer medium-length videos (not 1h compilations or 5s clips)
    const dur = r.duration || 0;
    if (dur > 0) {
      if (dur < 60 || dur > 600) score -= 3;
      else score += 2;

      // Strongly reward matches close to the Spotify track duration
      if (spotifyDurationSec) {
        const diff = Math.abs(dur - spotifyDurationSec);
        if (diff <= 3) score += 10;          // very close match
        else if (diff <= 8) score += 6;      // reasonably close
        else if (diff >= 20) score -= 6;     // way off
      }

      // If we have at least one strong artist candidate, heavily penalize results
      // that don't mention the artist in title or channel. This helps avoid
      // very popular songs with the same title but different artist.
      if (preferArtistStrict && artistNorm) {
        const hasArtist =
          ytTitle.includes(artistNorm) ||
          ytChannel.includes(artistNorm);
        if (!hasArtist) {
          score -= 20;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return best;
}

/**
 * Fetch rich track metadata from Spotify Web API using client credentials.
 * Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.
 */
async function getSpotifyTrackMetadata(url) {
  const idMatch = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (!idMatch) return null;
  const trackId = idMatch[1];

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[Spotify meta] token error', tokenRes.status, text.slice(0, 200));
      return null;
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) return null;

    const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!trackRes.ok) {
      const text = await trackRes.text();
      console.error('[Spotify meta] track error', trackRes.status, text.slice(0, 200));
      return null;
    }
    const track = await trackRes.json();
    return {
      title: track.name || '',
      artists: Array.isArray(track.artists) ? track.artists.map((a) => a.name).filter(Boolean) : [],
      album: track.album?.name || null,
      durationSec: track.duration_ms ? track.duration_ms / 1000 : null,
    };
  } catch (e) {
    console.error('[Spotify meta]', e.message);
    return null;
  }
}

/** List audio files in dir, sorted by mtime (newest first). Returns relative paths for API. */
function listAudioFilesInDir(dir) {
  const fs = require('fs');
  const audioExts = ['.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav'];
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => audioExts.some((ext) => f.toLowerCase().endsWith(ext)));
    return files.sort((a, b) => {
      const statA = fs.statSync(path.join(dir, a));
      const statB = fs.statSync(path.join(dir, b));
      return statB.mtimeMs - statA.mtimeMs; // newest first
    });
  } catch {
    return [];
  }
}

/**
 * Download using yt-dlp
 */
function downloadWithYtDlp({
  url,
  format,
  quality,
  audioBitrate,
  filenameTemplate,
  subtitleLangs,
  isPlaylist,
  subtitles,
  removeWatermark,
  downloadDir,
  site,
   embedSubtitles,
   startTime,
   endTime,
   limitRate,
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    const baseTemplate = sanitizeTemplate(filenameTemplate) || '%(title)s - %(uploader)s.%(ext)s';
    const outputTemplate = path.join(path.resolve(downloadDir), baseTemplate);

    const args = [
      '-o', outputTemplate,
      '--newline',
      '--no-warnings',
    ];

    // Format and quality
    const formatStr = buildFormatString(quality, format);
    args.push('-f', formatStr);

    if (format === 'mp3') {
      args.push('--extract-audio', '--audio-format', 'mp3');
      if (audioBitrate) {
        args.push('--postprocessor-args', `FFmpegExtractAudio:-b:a ${audioBitrate}k`);
      }
      // Embed thumbnail and metadata for nicer MP3s
      args.push('--embed-thumbnail', '--embed-metadata');
    }

    // Playlist
    if (!isPlaylist) {
      args.push('--no-playlist');
    }

    // Subtitles (YouTube only)
    if (subtitles && site === 'youtube') {
      const langs = (subtitleLangs || 'en,en-US,en-GB').replace(/\s/g, '');
      args.push('--write-subs', '--sub-langs', langs || 'en');
      if (embedSubtitles) {
        args.push('--embed-subs');
      }
    }

    // TikTok watermark removal
    if (removeWatermark && site === 'tiktok') {
      args.push('--no-watermark');
    }

    // Time range download
    const start = (startTime || '').trim();
    const end = (endTime || '').trim();
    if (start || end) {
      const section = `*${start || ''}-${end || ''}`;
      args.push('--download-sections', section);
    }

    // Download speed limiter
    if (limitRate) {
      args.push('--limit-rate', limitRate);
    }

    args.push(url);

    const proc = spawn('yt-dlp', args, {
      cwd: path.resolve(downloadDir),
    });

    const progressRegex = /(\d+\.?\d*)%/;
    const downloadedFiles = [];
    let lastPercent = 0;

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      const match = str.match(progressRegex);
      if (match && onProgress) {
        const percent = parseFloat(match[1]);
        if (percent > lastPercent) {
          lastPercent = percent;
          onProgress(Math.min(100, percent));
        }
      }
      // Also detect "[download] Destination: ..." for filename
      const destMatch = str.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        downloadedFiles.push(path.basename(destMatch[1].trim()));
      }
    });

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      const match = str.match(progressRegex);
      if (match && onProgress) {
        const percent = parseFloat(match[1]);
        if (percent > lastPercent) {
          lastPercent = percent;
          onProgress(Math.min(100, percent));
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('yt-dlp download failed'));
      }

      // If we didn't capture from stdout, list download dir
      const fs = require('fs');
      const dir = path.resolve(downloadDir);
      const files = downloadedFiles.length > 0
        ? downloadedFiles
        : fs.readdirSync(dir)
            .filter(f => !f.startsWith('.') && f !== '.gitkeep')
            .map(f => f);

      resolve(files);
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = {
  detectSite,
  getInfo,
  download,
  getSpotifyCandidates,
};
