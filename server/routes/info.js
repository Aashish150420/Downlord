/**
 * POST /api/info - Fetch video/audio metadata from URL
 * Detects site type and returns title, thumbnail, duration, uploader, etc.
 */

const express = require("express");
const router = express.Router();
const { getInfo, getPlaylistEntries } = require("../utils/ytdlp");

router.post("/", async (req, res) => {
  try {
    const { url } = req.body;
    const downloadDir = process.env.DOWNLOAD_DIR || "./downloads";

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    const info = await getInfo(url.trim(), downloadDir);
    res.json(info);
  } catch (err) {
    console.error("/api/info error:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch info" });
  }
});

router.post("/playlist", async (req, res) => {
  try {
    const { url, limit } = req.body || {};
    const downloadDir = process.env.DOWNLOAD_DIR || "./downloads";

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    const data = await getPlaylistEntries(
      url.trim(),
      downloadDir,
      limit || 200,
    );
    res.json(data);
  } catch (err) {
    console.error("/api/info/playlist error:", err.message);
    res
      .status(500)
      .json({ error: err.message || "Failed to fetch playlist items" });
  }
});

module.exports = router;
