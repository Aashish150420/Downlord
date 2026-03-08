/**
 * API Router — all /api/* routes in one place
 * Mounted at /api so requests never hit static/catch-all
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const infoRouter = require('./info');
const downloadRouter = require('./download');
const historyRouter = require('./history');
const { getSpotifyCandidates } = require('../utils/ytdlp');

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || './downloads';
const downloadPath = path.resolve(DOWNLOAD_DIR);

// #region agent log
const LOG_PATH = require('path').join(__dirname, '..', '..', 'debug-9b862e.log');
router.use((req, res, next) => {
  const p = req.path || req.url?.split('?')[0] || '';
  try { require('fs').appendFileSync(LOG_PATH, JSON.stringify({sessionId:'9b862e',location:'api.js:router-entry',message:'inside api router',data:{path:p,url:req.url},timestamp:Date.now(),hypothesisId:'B,C'}) + '\n'); } catch(e){}
  next();
});
// #endregion

/* ---------- Test Spotify (verify spotdl, yt-dlp, ffmpeg) ---------- */
function testSpotifyHandler(req, res) {
  // #region agent log
  try { require('fs').appendFileSync(require('path').join(__dirname,'..','..','debug-9b862e.log'), JSON.stringify({sessionId:'9b862e',location:'api.js:testSpotifyHandler',message:'handler running sending json',data:{path:req.path},timestamp:Date.now(),hypothesisId:'C,D'}) + '\n'); } catch(e){}
  // #endregion
  const { execSync } = require('child_process');
  const results = {};
  try { results.spotdl = execSync('spotdl --version').toString().trim(); } catch { results.spotdl = 'NOT FOUND'; }
  try { results.python3_spotdl = execSync('python3 -m spotdl --version').toString().trim(); } catch { results.python3_spotdl = 'NOT FOUND'; }
  try { results.py_spotdl = execSync('py -m spotdl --version').toString().trim(); } catch { results.py_spotdl = 'NOT FOUND'; }
  try { results.ytdlp = execSync('yt-dlp --version').toString().trim(); } catch { results.ytdlp = 'NOT FOUND'; }
  try { results.ffmpeg = execSync('ffmpeg -version').toString().split('\n')[0]; } catch { results.ffmpeg = 'NOT FOUND'; }
  res.json(results);
}

router.get('/test-spotify', testSpotifyHandler);
router.get('/info/test-spotify', testSpotifyHandler);

/* ---------- Info, Download, History ---------- */
router.use('/info', infoRouter);
router.use('/download', downloadRouter);
router.use('/history', historyRouter);

/* ---------- Spotify candidates for manual selection ---------- */
router.post('/spotify/candidates', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }
    const candidates = await getSpotifyCandidates(url.trim(), DOWNLOAD_DIR);
    res.json({ candidates });
  } catch (err) {
    console.error('/api/spotify/candidates error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to load candidates' });
  }
});

/* ---------- File download ---------- */
router.get('/files/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  if (!filename || filename.includes('..') || filename.includes('\\') || filename.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(downloadPath, filename);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath, filename, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
    else {
      // Some browsers issue a HEAD request before GET; only delete the file
      // after a real GET so the subsequent download still works.
      if (req.method !== 'HEAD') {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
      }
    }
  });
});

/* ---------- 404 for unknown API paths ---------- */
router.use((req, res) => {
  // #region agent log
  try { require('fs').appendFileSync(require('path').join(__dirname,'..','..','debug-9b862e.log'), JSON.stringify({sessionId:'9b862e',location:'api.js:404-fallback',message:'api 404 fallback hit',data:{path:req.path,url:req.url},timestamp:Date.now(),hypothesisId:'C,E'}) + '\n'); } catch(e){}
  // #endregion
  res.status(404).json({ error: 'API route not found', path: req.path });
});

module.exports = router;
