/**
 * POST /api/download - Start download with SSE progress stream
 * Supports batch URLs, queue, retry, and re-download from history
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const router = express.Router();
const { download, detectSite } = require("../utils/ytdlp");
const { addEntry } = require("../utils/history");
const { enqueue } = require("../utils/queue");

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "./downloads";
const HISTORY_FILE = process.env.HISTORY_FILE || "./history.json";

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Parse URL(s) - single string or array
 */
function parseUrls(body) {
  const { url, urls } = body || {};
  if (Array.isArray(urls) && urls.length > 0) {
    return urls.filter((u) => u && typeof u === "string").map((u) => u.trim());
  }
  if (url && typeof url === "string") {
    return [url.trim()];
  }
  return [];
}

/**
 * POST /api/download
 * Body: { url or urls, format, quality, audioBitrate, filenameTemplate, subtitleLangs,
 *         isPlaylist, subtitles, removeWatermark, title(s), reDownload (use history entry) }
 */
router.post("/", async (req, res) => {
  const urls = parseUrls(req.body);
  if (urls.length === 0) {
    return res.status(400).json({ error: "URL or urls array is required" });
  }

  const {
    format = "mp4",
    quality = "best",
    audioBitrate = "",
    filenameTemplate = "",
    subtitleLangs = "en,en-US,en-GB",
    isPlaylist = false,
    subtitles = false,
    removeWatermark = false,
    title = "Unknown",
    titles = [], // For batch - array of titles
    spotifyYoutubeUrl = "",
    embedSubtitles = false,
    subtitleMode = "separate",
    startTime = "",
    endTime = "",
    limitRate = "",
  } = req.body || {};

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === "function") res.flush();
  };

  try {
    await enqueue(async () => {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const itemTitle =
          Array.isArray(titles) && titles[i] ? titles[i] : title;
        const total = urls.length;
        const filenames = await download({
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
          subtitleMode,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          limitRate: limitRate || undefined,
          onProgress: (percent, meta = {}) => {
            const offset = total > 1 ? (i / total) * 100 : 0;
            const scale = total > 1 ? 100 / total : 100;
            sendEvent({
              type: "progress",
              percent: offset + (percent * scale) / 100,
              itemPercent: Math.max(0, Math.min(100, percent || 0)),
              itemIndex: i,
              itemTotal: total,
              speed: meta.speed || null,
              eta: meta.eta || null,
            });
          },
        });

        const site = detectSite(url);
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

        let mediaFound = 0;
        for (const filename of filenames) {
          const ext = path.extname(filename || "").toLowerCase();
          // Only treat audio/video files as completed downloads; skip sidecar subtitle/metadata files
          if (!mediaExts.includes(ext)) continue;
          mediaFound++;

          const filePath = path.resolve(DOWNLOAD_DIR, filename);
          if (!fs.existsSync(filePath)) {
            sendEvent({
              type: "error",
              message: `Download finished but output file is missing: ${filename}`,
            });
            continue;
          }

          const stat = fs.statSync(filePath);
          if (!stat.isFile() || stat.size <= 0) {
            sendEvent({
              type: "error",
              message: `Downloaded file is empty or invalid: ${filename}`,
            });
            continue;
          }

          const checksum = await sha256File(filePath);

          addEntry(
            {
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
              subtitleMode,
              removeWatermark,
              isPlaylist,
              checksum,
              fileSize: stat.size,
              status: "completed",
            },
            HISTORY_FILE,
          );
          sendEvent({ type: "done", filename, checksum, fileSize: stat.size });
        }

        if (mediaFound === 0) {
          // If yt-dlp succeeded but we couldn't identify the final media file,
          // send a clear error so the UI doesn't falsely show "complete".
          sendEvent({
            type: "error",
            message: `Download finished but no media file was detected. Files: ${(filenames || []).join(", ") || "none"}`,
          });
        }
      }
    });
  } catch (err) {
    console.error("/api/download error:", err.message);
    sendEvent({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
