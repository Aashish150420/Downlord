/**
 * POST /api/download - Start download with SSE progress stream
 * Supports batch URLs, queue, retry, and re-download from history
 */

const express = require('express');
const router = express.Router();
const { download, detectSite } = require('../utils/ytdlp');
const { addEntry } = require('../utils/history');
const { enqueue } = require('../utils/queue');

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || './downloads';
const HISTORY_FILE = process.env.HISTORY_FILE || './history.json';

/**
 * Parse URL(s) - single string or array
 */
function parseUrls(body) {
  const { url, urls } = body || {};
  if (Array.isArray(urls) && urls.length > 0) {
    return urls.filter((u) => u && typeof u === 'string').map((u) => u.trim());
  }
  if (url && typeof url === 'string') {
    return [url.trim()];
  }
  return [];
}

/**
 * POST /api/download
 * Body: { url or urls, format, quality, audioBitrate, filenameTemplate, subtitleLangs,
 *         isPlaylist, subtitles, removeWatermark, title(s), reDownload (use history entry) }
 */
router.post('/', async (req, res) => {
  const urls = parseUrls(req.body);
  if (urls.length === 0) {
    return res.status(400).json({ error: 'URL or urls array is required' });
  }

  const {
    format = 'mp4',
    quality = 'best',
    audioBitrate = '',
    filenameTemplate = '',
    subtitleLangs = 'en,en-US,en-GB',
    isPlaylist = false,
    subtitles = false,
    removeWatermark = false,
    title = 'Unknown',
    titles = [], // For batch - array of titles
    spotifyYoutubeUrl = '',
    embedSubtitles = false,
    startTime = '',
    endTime = '',
    limitRate = '',
  } = req.body || {};

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  try {
    await enqueue(async () => {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const itemTitle = Array.isArray(titles) && titles[i] ? titles[i] : title;
        const total = urls.length;
        await download({
          url,
          format,
          quality,
          audioBitrate: audioBitrate || undefined,
          filenameTemplate: filenameTemplate || undefined,
          subtitleLangs: subtitleLangs || undefined,
          isPlaylist,
          subtitles,
          removeWatermark,
          downloadDir: DOWNLOAD_DIR,
          spotifyYoutubeUrl: spotifyYoutubeUrl || undefined,
          embedSubtitles: !!embedSubtitles,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          limitRate: limitRate || undefined,
          onProgress: (percent) => {
            const offset = total > 1 ? (i / total) * 100 : 0;
            const scale = total > 1 ? 100 / total : 100;
            sendEvent({ type: 'progress', percent: offset + (percent * scale) / 100 });
          },
        }).then((filenames) => {
          const site = detectSite(url);
          filenames.forEach((filename) => {
            addEntry({
              title: itemTitle,
              url,
              format,
              quality,
              audioBitrate: audioBitrate || null,
              filenameTemplate: filenameTemplate || null,
              subtitleLangs: subtitleLangs || null,
              site,
              filename,
              subtitles,
              removeWatermark,
              isPlaylist,
              status: 'completed',
            }, HISTORY_FILE);
            sendEvent({ type: 'done', filename });
          });
          return filenames;
        });
      }
    });
  } catch (err) {
    console.error('/api/download error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
