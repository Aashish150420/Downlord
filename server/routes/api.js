/**
 * API Router — all /api/* routes in one place
 * Mounted at /api so requests never hit static/catch-all
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { execSync } = require("child_process");

const router = express.Router();
const infoRouter = require("./info");
const downloadRouter = require("./download");
const historyRouter = require("./history");
const { getSpotifyCandidates } = require("../utils/ytdlp");
const { readHistory } = require("../utils/history");

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "./downloads";
const HISTORY_FILE = process.env.HISTORY_FILE || "./history.json";
const downloadPath = path.resolve(DOWNLOAD_DIR);

// #region agent log
const LOG_PATH = require("path").join(
  __dirname,
  "..",
  "..",
  "debug-9b862e.log",
);
router.use((req, res, next) => {
  const p = req.path || req.url?.split("?")[0] || "";
  try {
    require("fs").appendFileSync(
      LOG_PATH,
      JSON.stringify({
        sessionId: "9b862e",
        location: "api.js:router-entry",
        message: "inside api router",
        data: { path: p, url: req.url },
        timestamp: Date.now(),
        hypothesisId: "B,C",
      }) + "\n",
    );
  } catch (e) {}
  next();
});
// #endregion

/* ---------- Test Spotify (verify spotdl, yt-dlp, ffmpeg) ---------- */
function testSpotifyHandler(req, res) {
  // #region agent log
  try {
    require("fs").appendFileSync(
      require("path").join(__dirname, "..", "..", "debug-9b862e.log"),
      JSON.stringify({
        sessionId: "9b862e",
        location: "api.js:testSpotifyHandler",
        message: "handler running sending json",
        data: { path: req.path },
        timestamp: Date.now(),
        hypothesisId: "C,D",
      }) + "\n",
    );
  } catch (e) {}
  // #endregion
  const { execSync } = require("child_process");
  const results = {};
  try {
    results.spotdl = execSync("spotdl --version").toString().trim();
  } catch {
    results.spotdl = "NOT FOUND";
  }
  try {
    results.python3_spotdl = execSync("python3 -m spotdl --version")
      .toString()
      .trim();
  } catch {
    results.python3_spotdl = "NOT FOUND";
  }
  try {
    results.py_spotdl = execSync("py -m spotdl --version").toString().trim();
  } catch {
    results.py_spotdl = "NOT FOUND";
  }
  try {
    results.ytdlp = execSync("yt-dlp --version").toString().trim();
  } catch {
    results.ytdlp = "NOT FOUND";
  }
  try {
    results.ffmpeg = execSync("ffmpeg -version").toString().split("\n")[0];
  } catch {
    results.ffmpeg = "NOT FOUND";
  }
  res.json(results);
}

router.get("/test-spotify", testSpotifyHandler);
router.get("/info/test-spotify", testSpotifyHandler);

/* ---------- Dependency health ---------- */
router.get("/health/deps", (req, res) => {
  const check = (command) => {
    try {
      const output = execSync(command, { stdio: ["ignore", "pipe", "pipe"] })
        .toString()
        .trim();
      return { ok: true, value: output.split(/\r?\n/)[0] || "ok" };
    } catch (error) {
      return {
        ok: false,
        value: (error && error.message ? error.message : "not available")
          .toString()
          .slice(0, 220),
      };
    }
  };

  const ytDlp = check("yt-dlp --version");
  const ffmpeg = check("ffmpeg -version");

  res.json({
    ok: ytDlp.ok && ffmpeg.ok,
    ytDlp,
    ffmpeg,
    timestamp: new Date().toISOString(),
  });
});

/* ---------- Info, Download, History ---------- */
router.use("/info", infoRouter);
router.use("/download", downloadRouter);
router.use("/history", historyRouter);

/* ---------- Spotify candidates for manual selection ---------- */
router.post("/spotify/candidates", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }
    const candidates = await getSpotifyCandidates(url.trim(), DOWNLOAD_DIR);
    res.json({ candidates });
  } catch (err) {
    console.error("/api/spotify/candidates error:", err.message);
    res.status(500).json({ error: err.message || "Failed to load candidates" });
  }
});

/* ---------- File download ---------- */
router.get("/files/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  if (
    !filename ||
    filename.includes("..") ||
    filename.includes("\\") ||
    filename.startsWith("/")
  ) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const filePath = path.join(downloadPath, filename);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: "File not found", filename });
  }
  res.download(filePath, filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Download failed", filename });
    }
    // NOTE: we no longer delete the file here. This avoids race conditions
    // where the browser (or multiple tabs) issues more than one request and
    // then reports "no file" even though the download actually succeeded once.
  });
});

/* ---------- Open downloads folder (local Windows helper) ---------- */
router.post("/open-downloads", (req, res) => {
  if (process.platform !== "win32") {
    return res.status(400).json({
      error:
        "Opening the downloads folder from the web app is supported on local Windows only.",
    });
  }

  if (!fs.existsSync(downloadPath)) {
    return res.status(404).json({ error: "Downloads folder does not exist" });
  }

  try {
    const proc = spawn("explorer", [downloadPath], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    return res.json({ message: "Downloads folder opened", path: downloadPath });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to open downloads folder",
      detail: err.message,
    });
  }
});

/* ---------- Export logs ---------- */
router.get("/logs/export", (req, res) => {
  try {
    const history = readHistory(HISTORY_FILE);
    const debugLog = fs.existsSync(LOG_PATH)
      ? fs
          .readFileSync(LOG_PATH, "utf8")
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-2000)
      : [];

    const payload = {
      exportedAt: new Date().toISOString(),
      downloadDir: downloadPath,
      historyCount: history.length,
      history,
      debugLog,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fluxdl-logs-${Date.now()}.json"`,
    );
    res.end(JSON.stringify(payload, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to export logs" });
  }
});

/* ---------- 404 for unknown API paths ---------- */
router.use((req, res) => {
  // #region agent log
  try {
    require("fs").appendFileSync(
      require("path").join(__dirname, "..", "..", "debug-9b862e.log"),
      JSON.stringify({
        sessionId: "9b862e",
        location: "api.js:404-fallback",
        message: "api 404 fallback hit",
        data: { path: req.path, url: req.url },
        timestamp: Date.now(),
        hypothesisId: "C,E",
      }) + "\n",
    );
  } catch (e) {}
  // #endregion
  res.status(404).json({ error: "API route not found", path: req.path });
});

module.exports = router;
