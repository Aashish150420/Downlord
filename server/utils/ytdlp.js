/**
 * yt-dlp and spotDL subprocess wrapper
 * Handles video/audio downloads from YouTube, Instagram, TikTok, Twitter, etc.
 * Uses spotDL for Spotify URLs only.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function classifyYtDlpError(stderr = "") {
  const text = String(stderr || "").toLowerCase();
  const trimmed = String(stderr || "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /unable to download video subtitles.*429|video subtitles.*too many requests|http error 429.*subtitles/.test(
      text,
    )
  ) {
    return "Subtitle download was rate-limited by the source (HTTP 429). Select one available subtitle language or retry later.";
  }

  if (/drm|protected content|widevine|playready/.test(text)) {
    return "This video appears to be DRM-protected and cannot be downloaded.";
  }

  if (
    /not available in your country|geo[- ]?restricted|this content is not available in your region/.test(
      text,
    )
  ) {
    return "This video is geo-restricted and not available from your current region.";
  }

  if (
    /unsupported url|invalid url|unable to extract|no video formats found|url could be a direct video link/.test(
      text,
    )
  ) {
    return "Invalid or unsupported URL. Please paste a direct supported media page URL.";
  }

  if (/requested format is not available|format not available/.test(text)) {
    return "The selected quality is not available for this video. Try Best or a lower resolution.";
  }

  if (
    /private video|members-only|login required|sign in to confirm/.test(text)
  ) {
    return "This video requires login or is private, so it cannot be downloaded here.";
  }

  if (trimmed) {
    return `Download failed: ${trimmed.slice(0, 280)}`;
  }

  return "Download failed. The source may be unavailable or temporarily blocked.";
}

function parseProgressMeta(line = "") {
  const percentMatch = line.match(/(\d+\.?\d*)%/);
  const speedMatch = line.match(/\bat\s+([^\s]+(?:\s?i?b\/s|b\/s))/i);
  const etaMatch = line.match(/\beta\s+([0-9:]+)/i);

  return {
    percent: percentMatch ? parseFloat(percentMatch[1]) : null,
    speed: speedMatch ? speedMatch[1] : null,
    eta: etaMatch ? etaMatch[1] : null,
  };
}

function collectSubtitleLanguages(info = {}) {
  const langs = new Set();
  [info.subtitles, info.automatic_captions].forEach((group) => {
    if (!group || typeof group !== "object") return;
    Object.keys(group).forEach((lang) => {
      if (lang && lang !== "live_chat") langs.add(lang);
    });
  });
  return [...langs].sort((a, b) => a.localeCompare(b));
}

function collectAvailableQualities(info = {}) {
  const heights = new Set();
  const formats = Array.isArray(info.formats) ? info.formats : [];

  formats.forEach((format) => {
    if (!format || format.vcodec === "none") return;
    if (typeof format.height === "number" && format.height > 0) {
      heights.add(format.height);
    }
  });

  return [
    "best",
    ...[...heights].sort((a, b) => b - a).map((height) => String(height)),
  ];
}

function escapeFfmpegSubtitlePath(filePath) {
  return String(filePath)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/'/g, "\\'");
}

// Map URL patterns to site identifiers for badges and logic
const SITE_PATTERNS = [
  { pattern: /youtube\.com|youtu\.be/i, site: "youtube" },
  { pattern: /instagram\.com/i, site: "instagram" },
  { pattern: /tiktok\.com|vm\.tiktok/i, site: "tiktok" },
  { pattern: /(?:twitter|x)\.com/i, site: "twitter" },
  { pattern: /facebook\.com|fb\.watch|fb\.com/i, site: "facebook" },
  { pattern: /soundcloud\.com/i, site: "soundcloud" },
  { pattern: /spotify\.com/i, site: "spotify" },
];

/**
 * Detect which site a URL belongs to
 * @param {string} url - The media URL
 * @returns {string} - Site identifier (youtube, instagram, tiktok, etc.)
 */
function detectSite(url) {
  if (!url || typeof url !== "string") return "unknown";
  for (const { pattern, site } of SITE_PATTERNS) {
    if (pattern.test(url)) return site;
  }
  return "unknown";
}

/**
 * Normalize Spotify URL for oEmbed (requires full https://open.spotify.com/...)
 */
function normalizeSpotifyUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("https://open.spotify.com/")) return url;
  if (url.startsWith("http://open.spotify.com/"))
    return url.replace("http://", "https://");
  if (url.startsWith("open.spotify.com/")) return "https://" + url;
  if (url.includes("spotify.com/")) {
    const match = url.match(
      /spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/,
    );
    if (match) return `https://open.spotify.com/${match[1]}/${match[2]}`;
  }
  return url;
}

const SPOTIFY_API_BLOCK_MS = 6 * 60 * 60 * 1000;
let spotifyApiBlockedUntil = 0;

function splitArtistTokens(value) {
  return String(value || "")
    .split(/,|&|\bx\b|\bfeat\.?\b|\bft\.?\b/gi)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSpotifyOEmbedMeta(title, author) {
  const cleanedTitle = String(title || "")
    .replace(/\s*\|\s*spotify.*$/i, "")
    .trim();
  const cleanedAuthor = String(author || "").trim();

  if (!cleanedTitle && !cleanedAuthor) {
    return { title: "", artists: [] };
  }

  const byMatch = cleanedTitle.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      title: byMatch[1].trim(),
      artists: splitArtistTokens(byMatch[2]),
    };
  }

  const isGenericAuthor = /^(spotify|unknown)$/i.test(cleanedAuthor);
  return {
    title: cleanedTitle,
    artists: isGenericAuthor ? [] : splitArtistTokens(cleanedAuthor),
  };
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
  if (site === "spotify") {
    const isPlaylist = /spotify\.com\/(playlist|album)/i.test(url);
    const normalizedUrl = normalizeSpotifyUrl(url);
    try {
      const oembedUrl =
        "https://open.spotify.com/oembed?url=" +
        encodeURIComponent(normalizedUrl);
      console.log("[Spotify oEmbed] Fetching:", oembedUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(oembedUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await res.text();
      console.log("[Spotify oEmbed] Status:", res.status);

      if (!res.ok) {
        console.error(
          "[Spotify oEmbed] Failed:",
          res.status,
          text.slice(0, 300),
        );
        throw new Error(`oEmbed returned ${res.status}`);
      }

      if (text) {
        const data = JSON.parse(text);
        if (data && (data.title || data.thumbnail_url)) {
          return {
            title: data.title || "Spotify content",
            thumbnail: data.thumbnail_url || null,
            duration: null,
            uploader: data.author_name || data.provider_name || null,
            site: "spotify",
            isPlaylist,
            hasSubtitles: false,
          };
        }
      }
    } catch (e) {
      console.error("[Spotify oEmbed]", e.message);
    }
    return {
      title: "Spotify content",
      thumbnail: null,
      duration: null,
      uploader: null,
      site: "spotify",
      isPlaylist,
      hasSubtitles: false,
    };
  }

  // Use yt-dlp for all other sites
  return new Promise((resolve, reject) => {
    const fs = require("fs");
    const dir = path.resolve(downloadDir);
    const downloadStartedAt = Date.now();
    const args = ["--dump-json", "--no-download", "--no-warnings", url];

    const proc = spawn("yt-dlp", args, {
      cwd: dir,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || "Failed to fetch info"));
      }

      try {
        // Handle playlists: yt-dlp outputs one JSON object per line for playlists
        const lines = stdout.trim().split("\n").filter(Boolean);
        const first = lines[0] ? JSON.parse(lines[0]) : {};
        const isPlaylist = first._type === "playlist" || lines.length > 1;
        const entry =
          isPlaylist && first.entries?.[0] ? first.entries[0] : first;
        const info = entry || first;

        resolve({
          title: info.title || "Unknown",
          thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null,
          duration: info.duration || null,
          uploader: info.uploader || info.creator || info.channel || null,
          site,
          isPlaylist,
          availableQualities: collectAvailableQualities(info),
          subtitleLanguages: collectSubtitleLanguages(info),
          hasSubtitles:
            (site === "youtube" &&
              !!(info.subtitles && Object.keys(info.subtitles).length > 0)) ||
            !!(
              info.automatic_captions &&
              Object.keys(info.automatic_captions).length > 0
            ),
          approxSize: info.filesize_approx || info.filesize || null,
        });
      } catch (err) {
        reject(new Error("Failed to parse yt-dlp output"));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * Build yt-dlp format string based on quality
 * @param {string} quality - 'best' | '1440' | '1080' | '720' | '360'
 * @param {string} format - 'mp4' | 'mp3'
 * @returns {string} - yt-dlp format selector
 */
function buildFormatString(quality, format) {
  if (format === "mp3") {
    // Audio-only downloads; yt-dlp will extract and we control bitrate via FFmpegExtractAudio.
    return "bestaudio/best";
  }

  // Prefer the best available video stream up to the selected cap.
  // We transcode the final result to H.264/AAC later for compatibility,
  // so quality selection should focus on getting the highest-quality source.
  const videoPart = (h) => (h ? `bestvideo*[height<=${h}]` : `bestvideo*`);
  const fallback = (h) => (h ? `best[height<=${h}]/best` : `best`);

  const numericQuality = Number.parseInt(quality, 10);
  if (Number.isFinite(numericQuality) && numericQuality > 0) {
    return `${videoPart(numericQuality)}+bestaudio/${fallback(numericQuality)}`;
  }

  return `${videoPart(null)}+bestaudio/${fallback(null)}`;
}

/**
 * Sanitize filename template - only allow safe yt-dlp placeholders
 */
const SAFE_TEMPLATE = /^[a-zA-Z0-9%(.)._\-\s]+$/;
function sanitizeTemplate(template) {
  if (!template || typeof template !== "string") return null;
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
  subtitleMode,
  startTime,
  endTime,
  limitRate,
  onProgress,
}) {
  const site = detectSite(url);

  if (site === "spotify") {
    const forcedFormat = "mp3";
    return downloadSpotifyViaYoutube({
      url,
      format: forcedFormat,
      quality,
      audioBitrate,
      filenameTemplate,
      subtitleLangs: undefined,
      isPlaylist,
      spotifyYoutubeUrl,
      downloadDir,
      embedSubtitles: false,
      subtitleMode: "separate",
      startTime,
      endTime,
      limitRate,
      onProgress,
    });
  }

  try {
    return await downloadWithYtDlp({
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
      subtitleMode,
      startTime,
      endTime,
      limitRate,
      onProgress,
    });
  } catch (error) {
    const message = String(error?.message || "");
    const shouldRetryWithoutSubtitles =
      subtitles &&
      site === "youtube" &&
      /subtitle download was rate-limited|unable to download video subtitles|http error 429/i.test(
        message,
      );

    if (!shouldRetryWithoutSubtitles) {
      throw error;
    }

    console.warn(
      "[yt-dlp] Subtitle requests were rate-limited. Retrying without subtitles.",
    );

    return downloadWithYtDlp({
      url,
      format,
      quality,
      audioBitrate,
      filenameTemplate,
      subtitleLangs: undefined,
      isPlaylist,
      subtitles: false,
      removeWatermark,
      downloadDir,
      site,
      embedSubtitles: false,
      subtitleMode: "separate",
      startTime,
      endTime,
      limitRate,
      onProgress,
    });
  }
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
  subtitleMode,
  startTime,
  endTime,
  limitRate,
  onProgress,
}) {
  if (isPlaylist) {
    throw new Error(
      "Spotify playlists are not supported in fallback mode. Use individual track URLs instead.",
    );
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
      site: "youtube",
      embedSubtitles,
      subtitleMode,
      startTime,
      endTime,
      limitRate,
      onProgress,
    });
  }

  let query = "";
  let spotifyTitle = "";
  let spotifyArtists = [];
  let spotifyDurationSec = null;

  // Try rich metadata from Spotify Web API (if client credentials are configured)
  try {
    const meta = await getSpotifyTrackMetadata(url);
    if (meta) {
      spotifyTitle = meta.title || "";
      spotifyArtists = meta.artists || [];
      spotifyDurationSec = meta.durationSec || null;
      if (!query && meta.title) {
        query = meta.artists?.length
          ? `${meta.title} ${meta.artists.join(" ")}`
          : meta.title;
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
      const parsed = parseSpotifyOEmbedMeta(
        oembedInfo.title,
        oembedInfo.uploader,
      );
      if (!spotifyTitle && parsed.title) {
        spotifyTitle = parsed.title;
      }
      if (
        (!spotifyArtists || spotifyArtists.length === 0) &&
        parsed.artists.length
      ) {
        spotifyArtists = parsed.artists;
      }
      query = parsed.artists.length
        ? `${parsed.title} ${parsed.artists.join(" ")}`.trim()
        : parsed.title || oembedInfo.title;
    }
  } catch (_) {
    // fall through – we will just search by normalized URL
  }

  // If we have a reasonable query, do a multi-result YouTube search and pick the best match
  if (query) {
    try {
      const bestUrl = await findBestYoutubeMatchForSpotify({
        query,
        spotifyTitle: spotifyTitle || (oembedInfo && oembedInfo.title) || "",
        spotifyArtists: spotifyArtists.length
          ? spotifyArtists
          : oembedInfo && oembedInfo.uploader
            ? [oembedInfo.uploader]
            : [],
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
          site: "youtube",
          onProgress,
        });
      }
    } catch (e) {
      console.error(
        "[Spotify fallback] YouTube search failed, falling back to ytsearch1:",
        e.message,
      );
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
    site: "youtube",
    embedSubtitles,
    subtitleMode,
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
async function findBestYoutubeMatchForSpotify({
  query,
  spotifyTitle,
  spotifyArtists,
  durationSec,
  downloadDir,
}) {
  const searchQuery = `ytsearch30:${query}`;
  return new Promise((resolve, reject) => {
    const args = ["--dump-json", "--no-download", searchQuery];
    const proc = spawn("yt-dlp", args, {
      cwd: path.resolve(downloadDir),
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || "yt-dlp search failed"));
      }
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const results = lines.map((line) => JSON.parse(line));
        if (!results.length) return resolve(null);

        const artistCombined = (spotifyArtists || []).join(" ");
        const artistNorm = normalizeForMatch(artistCombined);
        const hasStrongArtistCandidate =
          !!artistNorm &&
          results.some((r) => {
            const ytTitle = normalizeForMatch(r.title || "");
            const ytChannel = normalizeForMatch(r.uploader || r.channel || "");
            return (
              ytTitle.includes(artistNorm) || ytChannel.includes(artistNorm)
            );
          });

        const best = scoreBestYoutubeResult(
          results,
          spotifyTitle || "",
          artistCombined,
          durationSec || null,
          hasStrongArtistCandidate,
        );
        resolve(best ? best.webpage_url || best.url : null);
      } catch (e) {
        reject(e);
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * Return a list of YouTube candidates for a Spotify track so the user can choose manually.
 */
async function getSpotifyCandidates(url, downloadDir) {
  const site = detectSite(url);
  if (site !== "spotify") return [];

  let query = "";
  let spotifyTitle = "";
  let spotifyArtists = [];
  let spotifyDurationSec = null;

  try {
    const meta = await getSpotifyTrackMetadata(url);
    if (meta && meta.title) {
      spotifyTitle = meta.title || "";
      spotifyArtists = meta.artists || [];
      spotifyDurationSec = meta.durationSec || null;
      query = meta.artists?.length
        ? `${meta.title} ${meta.artists.join(" ")}`
        : meta.title;
    }
  } catch (_) {}

  if (!query) {
    try {
      const info = await getInfo(url, downloadDir);
      if (info && info.title) {
        const parsed = parseSpotifyOEmbedMeta(info.title, info.uploader);
        spotifyTitle = parsed.title || info.title || spotifyTitle;
        if (parsed.artists.length) {
          spotifyArtists = parsed.artists;
        }
        query = parsed.artists.length
          ? `${spotifyTitle} ${parsed.artists.join(" ")}`.trim()
          : spotifyTitle;
      }
    } catch (_) {}
  }

  const normalizedUrl = normalizeSpotifyUrl(url);
  const searchQuery = query ? `ytsearch30:${query}` : normalizedUrl;

  return new Promise((resolve, reject) => {
    const args = ["--dump-json", "--no-download", searchQuery];
    const proc = spawn("yt-dlp", args, {
      cwd: path.resolve(downloadDir),
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const results = lines.map((line) => JSON.parse(line));

        const artistCombined = (spotifyArtists || []).join(" ");
        const artistNorm = normalizeForMatch(artistCombined);
        const hasStrongArtistCandidate =
          !!artistNorm &&
          results.some((r) => {
            const ytTitle = normalizeForMatch(r.title || "");
            const ytChannel = normalizeForMatch(r.uploader || r.channel || "");
            return (
              ytTitle.includes(artistNorm) || ytChannel.includes(artistNorm)
            );
          });

        const ranked = rankYoutubeResultsForSpotify(
          results,
          spotifyTitle || "",
          artistCombined,
          spotifyDurationSec,
          hasStrongArtistCandidate,
        );

        const candidates = ranked.map((item, index) => {
          const r = item.raw;
          return {
            url: r.webpage_url || r.url,
            title: r.title || "",
            uploader: r.uploader || r.channel || "",
            duration: r.duration || null,
            score: item.score,
            confidence: item.confidence,
            hasArtistMatch: item.hasArtistMatch,
            durationDiff: item.durationDiff,
            recommended: index === 0,
          };
        });

        if (candidates.length > 0) {
          // Even if yt-dlp exited with non-zero due to warnings, return whatever we parsed.
          if (code !== 0) {
            console.warn(
              "[Spotify candidates] yt-dlp exited with code",
              code,
              "but parsed",
              candidates.length,
              "results.",
            );
          }
          resolve(candidates);
        } else if (code !== 0) {
          reject(new Error(stderr || "yt-dlp search failed"));
        } else {
          resolve([]);
        }
      } catch (e) {
        reject(e);
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

function normalizeForMatch(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[\[\]\(\)\-_,\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifySpotifyMatchConfidence(score) {
  if (score >= 16) return "high";
  if (score >= 8) return "medium";
  return "low";
}

function rankYoutubeResultsForSpotify(
  results,
  spotifyTitle,
  spotifyArtist,
  spotifyDurationSec,
  preferArtistStrict,
) {
  const titleNorm = normalizeForMatch(spotifyTitle);
  const artistNorm = normalizeForMatch(spotifyArtist);
  const titleTokens = titleNorm.split(" ").filter(Boolean);

  const badWords = [
    "live",
    "remix",
    "slowed",
    "speed up",
    "sped up",
    "8d",
    "cover",
    "edit",
    "version",
    "playlist",
    "mix",
    "compilation",
    "hour",
    "loop",
    "nightcore",
    "karaoke",
    "reaction",
    "podcast",
    "interview",
    "full album",
    "trending",
    "hits",
    "best of",
    "2026",
    "2025",
  ];

  const goodWords = [
    "official audio",
    "audio",
    "topic",
    "provided to youtube",
    "lyric video",
  ];

  const ranked = [];

  for (const r of results) {
    const ytTitle = normalizeForMatch(r.title || "");
    const ytChannel = normalizeForMatch(r.uploader || r.channel || "");
    const ytCombined = `${ytTitle} ${ytChannel}`;

    let score = 0;

    if (titleNorm && ytTitle.includes(titleNorm)) score += 14;
    else if (titleNorm && ytCombined.includes(titleNorm)) score += 10;

    if (titleNorm && ytTitle.startsWith(titleNorm)) score += 3;

    for (const t of titleTokens) {
      if (ytTitle.includes(t)) score += 2;
      else if (ytChannel.includes(t)) score += 1;
    }

    if (artistNorm) {
      if (ytTitle.includes(artistNorm)) score += 4;
      if (ytChannel.includes(artistNorm)) score += 6;

      const splitArtists = artistNorm.split(" ").filter(Boolean);
      for (const token of splitArtists) {
        if (token.length < 3) continue;
        if (ytTitle.includes(token)) score += 1;
        if (ytChannel.includes(token)) score += 2;
      }
    }

    for (const w of badWords) {
      const inYtTitle = ytTitle.includes(w);
      const inSpotifyTitle = titleNorm.includes(w);
      if (inYtTitle && !inSpotifyTitle) score -= 6;
    }

    for (const w of goodWords) {
      if (ytCombined.includes(w)) score += 2;
    }

    if (/\b(official|vevo)\b/.test(ytChannel)) {
      score += 3;
    }

    if (/\bshorts\b/.test(ytCombined)) {
      score -= 8;
    }

    const dur = r.duration || 0;
    if (dur > 0) {
      if (dur < 60 || dur > 600) score -= 3;
      else score += 2;

      if (spotifyDurationSec) {
        const diff = Math.abs(dur - spotifyDurationSec);
        if (diff <= 3) score += 10;
        else if (diff <= 8) score += 6;
        else if (diff <= 15) score += 2;
        else if (diff >= 20) score -= 6;
        if (diff >= 45) score -= 10;
      }
    }

    if (preferArtistStrict && artistNorm) {
      const hasArtist =
        ytTitle.includes(artistNorm) || ytChannel.includes(artistNorm);
      if (!hasArtist) score -= 20;
    }

    ranked.push({
      raw: r,
      score,
      confidence: classifySpotifyMatchConfidence(score),
      hasArtistMatch:
        !!artistNorm &&
        (ytTitle.includes(artistNorm) || ytChannel.includes(artistNorm)),
      durationDiff:
        spotifyDurationSec && r.duration
          ? Math.abs((r.duration || 0) - spotifyDurationSec)
          : null,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

function scoreBestYoutubeResult(
  results,
  spotifyTitle,
  spotifyArtist,
  spotifyDurationSec,
  preferArtistStrict,
) {
  const ranked = rankYoutubeResultsForSpotify(
    results,
    spotifyTitle,
    spotifyArtist,
    spotifyDurationSec,
    preferArtistStrict,
  );
  return ranked.length ? ranked[0].raw : null;
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
  if (Date.now() < spotifyApiBlockedUntil) return null;

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.warn(
        "[Spotify meta] token error",
        tokenRes.status,
        text.slice(0, 200),
      );
      return null;
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) return null;

    const trackRes = await fetch(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (!trackRes.ok) {
      const text = await trackRes.text();
      const snippet = text.slice(0, 200);
      if (
        trackRes.status === 403 &&
        /active premium subscription required|premium subscription required/i.test(
          snippet,
        )
      ) {
        spotifyApiBlockedUntil = Date.now() + SPOTIFY_API_BLOCK_MS;
        console.warn(
          "[Spotify meta] Track API access blocked by Spotify app subscription policy; using oEmbed fallback.",
        );
        return null;
      }
      console.warn("[Spotify meta] track error", trackRes.status, snippet);
      return null;
    }
    const track = await trackRes.json();
    return {
      title: track.name || "",
      artists: Array.isArray(track.artists)
        ? track.artists.map((a) => a.name).filter(Boolean)
        : [],
      album: track.album?.name || null,
      durationSec: track.duration_ms ? track.duration_ms / 1000 : null,
    };
  } catch (e) {
    console.error("[Spotify meta]", e.message);
    return null;
  }
}

/** List audio files in dir, sorted by mtime (newest first). Returns relative paths for API. */
function listAudioFilesInDir(dir) {
  const audioExts = [".mp3", ".m4a", ".flac", ".opus", ".ogg", ".wav"];
  try {
    const files = fs
      .readdirSync(dir)
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

function listRecentFiles(dir, startedAt, allowedExts) {
  try {
    return fs.readdirSync(dir).filter((file) => {
      if (file.startsWith(".") || file === ".gitkeep") return false;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return false;
      if (stat.mtimeMs + 2000 < startedAt) return false;
      return allowedExts.includes(path.extname(file).toLowerCase());
    });
  } catch {
    return [];
  }
}

function normalizeMediaBaseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSubtitleFilesForMedia(mediaFile, subtitleFiles) {
  const baseName = path.parse(mediaFile).name;
  const normalizedBase = normalizeMediaBaseName(baseName);
  return subtitleFiles
    .filter((file) => {
      const nameWithoutExt = file.slice(0, -path.extname(file).length);
      const normalizedCandidate = normalizeMediaBaseName(nameWithoutExt);
      return (
        nameWithoutExt === baseName ||
        nameWithoutExt.startsWith(`${baseName}.`) ||
        normalizedCandidate === normalizedBase ||
        normalizedCandidate.startsWith(`${normalizedBase} `)
      );
    })
    .sort();
}

function getSubtitleLanguage(filename) {
  const match = filename.match(/\.([a-zA-Z-]+)\.(?:srt|vtt|ass)$/i);
  return match ? match[1].toLowerCase() : "";
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd });
    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(stderr || `${command} failed with exit code ${code}`),
        );
      }
      resolve();
    });

    proc.on("error", reject);
  });
}

async function ensureCompatibleMp4({
  dir,
  mediaFile,
  subtitleFiles,
  subtitleMode,
}) {
  const inputPath = path.join(dir, mediaFile);
  const sourceExt = path.extname(mediaFile).toLowerCase();
  const outputBaseName = path.parse(mediaFile).name;
  const finalName = `${outputBaseName}.mp4`;
  const finalPath = path.join(dir, finalName);
  const tempName = `${outputBaseName}.compat-${Date.now()}.mp4`;
  const tempPath = path.join(dir, tempName);
  const args = ["-y", "-i", inputPath];

  const resolvedSubtitleMode = subtitleMode || "separate";
  const existingSubtitleFiles = (subtitleFiles || []).filter((file) =>
    fs.existsSync(path.join(dir, file)),
  );
  const shouldSoftEmbed =
    resolvedSubtitleMode === "soft" && existingSubtitleFiles.length > 0;
  const shouldHardEmbed =
    resolvedSubtitleMode === "hard" && existingSubtitleFiles.length > 0;
  const needsVideoTranscode = true;
  let hardBurnTempSubtitle = null;

  if (shouldSoftEmbed) {
    existingSubtitleFiles.forEach((subtitleFile) => {
      args.push("-i", path.join(dir, subtitleFile));
    });
  }

  args.push(
    "-map_metadata",
    "0",
    "-map_chapters",
    "0",
    "-map",
    "0:v?",
    "-map",
    "0:a?",
  );

  if (shouldSoftEmbed) {
    existingSubtitleFiles.forEach((_, index) => {
      args.push("-map", `${index + 1}:0`);
    });
  }

  if (shouldHardEmbed) {
    const sourceSubtitlePath = path.join(dir, existingSubtitleFiles[0]);
    hardBurnTempSubtitle = path.join(
      dir,
      `__hardburn-${Date.now()}${path.extname(existingSubtitleFiles[0]) || ".srt"}`,
    );
    fs.copyFileSync(sourceSubtitlePath, hardBurnTempSubtitle);

    args.push(
      "-vf",
      `subtitles='${escapeFfmpegSubtitlePath(hardBurnTempSubtitle)}'`,
    );
  }

  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18");
  args.push("-pix_fmt", "yuv420p");
  args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");

  if (shouldSoftEmbed) {
    args.push("-c:s", "mov_text");
    existingSubtitleFiles.forEach((subtitleFile, index) => {
      const language = getSubtitleLanguage(subtitleFile);
      if (language) {
        args.push(`-metadata:s:s:${index}`, `language=${language}`);
      }
    });
    args.push("-disposition:s:0", "default");
  }

  args.push("-movflags", "+faststart", tempPath);

  try {
    await runProcess("ffmpeg", args, dir);
    if (hardBurnTempSubtitle) {
      fs.rmSync(hardBurnTempSubtitle, { force: true });
    }
    if (inputPath !== finalPath) {
      fs.rmSync(finalPath, { force: true });
      fs.rmSync(inputPath, { force: true });
      fs.renameSync(tempPath, finalPath);
      return finalName;
    }
    fs.rmSync(inputPath, { force: true });
    fs.renameSync(tempPath, inputPath);
    return mediaFile;
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    if (hardBurnTempSubtitle) {
      fs.rmSync(hardBurnTempSubtitle, { force: true });
    }

    if (shouldHardEmbed) {
      console.warn(
        "[ffmpeg] Hard-burn subtitles failed; retrying with soft subtitles.",
      );
      return ensureCompatibleMp4({
        dir,
        mediaFile,
        subtitleFiles: existingSubtitleFiles,
        subtitleMode: "soft",
      });
    }

    throw error;
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
  subtitleMode,
  startTime,
  endTime,
  limitRate,
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    const dir = path.resolve(downloadDir);
    const downloadStartedAt = Date.now();

    const defaultTemplate = isPlaylist
      ? "%(autonumber)03d - %(title)s - %(uploader)s.%(ext)s"
      : "%(title)s - %(uploader)s.%(ext)s";
    const baseTemplate = sanitizeTemplate(filenameTemplate) || defaultTemplate;
    const outputTemplate = path.join(dir, baseTemplate);
    const resolvedSubtitleMode =
      subtitleMode || (embedSubtitles ? "soft" : "separate");

    const args = [
      "-o",
      outputTemplate,
      "--newline",
      "--no-warnings",
      "--print",
      "after_move:__FINAL_FILE__:%(filepath)s",
      // Keep partial files and continue them to support interrupted downloads.
      "--continue",
      "--part",
    ];

    // Format and quality
    const formatStr = buildFormatString(quality, format);
    args.push("-f", formatStr);

    // Force final container when user selected MP4
    if (format === "mp4") {
      args.push("--merge-output-format", "mp4");
    }

    if (format === "mp3") {
      args.push("--extract-audio", "--audio-format", "mp3");
      if (audioBitrate) {
        args.push(
          "--postprocessor-args",
          `FFmpegExtractAudio:-b:a ${audioBitrate}k`,
        );
      }
      // Embed thumbnail and metadata for nicer MP3s
      args.push("--embed-thumbnail", "--embed-metadata");
    }

    // Playlist
    if (!isPlaylist) {
      args.push("--no-playlist");
    } else {
      args.push("--yes-playlist");
    }

    // Subtitles (YouTube only)
    if (subtitles && site === "youtube") {
      const langs = (subtitleLangs || "all").replace(/\s/g, "");
      // Download both regular and automatic subtitles where available.
      args.push(
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        langs || "all",
      );
      if (format !== "mp3") {
        args.push("--convert-subs", "srt");
      }
    }

    // TikTok watermark removal
    if (removeWatermark && site === "tiktok") {
      args.push("--no-watermark");
    }

    // Time range download
    const start = (startTime || "").trim();
    const end = (endTime || "").trim();
    if (start || end) {
      const section = `*${start || ""}-${end || ""}`;
      args.push("--download-sections", section);
    }

    // Download speed limiter
    if (limitRate) {
      args.push("--limit-rate", limitRate);
    }

    args.push(url);

    const proc = spawn("yt-dlp", args, {
      cwd: dir,
    });

    const progressRegex = /(\d+\.?\d*)%/;
    const downloadedFiles = [];
    const finalFiles = [];
    let lastPercent = 0;
    let stderrAll = "";

    const emitProgressFromLine = (line) => {
      const meta = parseProgressMeta(line);
      if (meta.percent == null || !onProgress) return;

      const percent = meta.percent;
      if (percent >= lastPercent) {
        lastPercent = percent;
        onProgress(Math.min(100, percent), {
          speed: meta.speed,
          eta: meta.eta,
        });
      }
    };

    proc.stdout.on("data", (data) => {
      const str = data.toString();
      str
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => {
          emitProgressFromLine(line);
          const finalMatch = line.match(/^__FINAL_FILE__:(.+)$/);
          if (finalMatch) {
            finalFiles.push(path.basename(finalMatch[1].trim()));
          }
        });
      // Also detect "[download] Destination: ..." for filename
      const destMatch = str.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        downloadedFiles.push(path.basename(destMatch[1].trim()));
      }
    });

    proc.stderr.on("data", (data) => {
      const str = data.toString();
      stderrAll += str;
      str
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => emitProgressFromLine(line));
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        const friendly = classifyYtDlpError(stderrAll);
        return reject(new Error(friendly));
      }

      // Prefer to infer final media files by modification time rather than
      // relying on stdout, which may list temporary fragments that yt-dlp
      // deletes after merging.
      const mediaExts = [
        ".mp4",
        ".webm",
        ".mkv",
        ".mp3",
        ".m4a",
        ".flac",
        ".opus",
        ".ogg",
        ".wav",
      ];
      const subtitleExts = [".srt", ".vtt", ".ass"];

      try {
        let files = [...new Set(finalFiles.filter(Boolean))];
        if (files.length === 0) {
          files = isPlaylist
            ? [...new Set(downloadedFiles)]
            : listRecentFiles(dir, downloadStartedAt, mediaExts);
        }
        if (!files || files.length === 0) {
          files = [...new Set(downloadedFiles)];
        }

        if (format === "mp4" && files.length > 0) {
          const videoExts = [".mp4", ".webm", ".mkv"];
          const subtitleFiles =
            subtitles && site === "youtube"
              ? listRecentFiles(dir, downloadStartedAt, subtitleExts)
              : [];

          const processedFiles = [];
          for (const file of files) {
            if (!videoExts.includes(path.extname(file).toLowerCase())) {
              processedFiles.push(file);
              continue;
            }

            const matchedSubtitleFiles =
              resolvedSubtitleMode !== "separate"
                ? getSubtitleFilesForMedia(file, subtitleFiles)
                : [];

            const finalFile = await ensureCompatibleMp4({
              dir,
              mediaFile: file,
              subtitleFiles: matchedSubtitleFiles,
              subtitleMode: resolvedSubtitleMode,
            });
            processedFiles.push(finalFile);
          }
          files = processedFiles;
        }

        resolve(files);
      } catch (error) {
        reject(new Error(`FFmpeg post-processing failed: ${error.message}`));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

module.exports = {
  detectSite,
  getInfo,
  download,
  getSpotifyCandidates,
};
