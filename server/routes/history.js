/**
 * GET  /api/history - Return all download history entries
 * DELETE /api/history/:id - Remove entry by id
 * DELETE /api/history - Clear all history (body: { clear: true })
 */

const express = require('express');
const router = express.Router();
const {
  readHistory,
  removeEntry,
  clearHistory,
} = require('../utils/history');

const HISTORY_FILE = process.env.HISTORY_FILE || './history.json';

// GET /api/history - list all entries (must be before /:id)
router.get('/', (req, res) => {
  try {
    const entries = readHistory(HISTORY_FILE);
    res.json(entries);
  } catch (err) {
    console.error('GET /api/history error:', err.message);
    res.status(500).json({ error: 'Failed to read history' });
  }
});

// GET /api/history/:id - get single entry (for re-download)
router.get('/:id', (req, res) => {
  try {
    const entries = readHistory(HISTORY_FILE);
    const entry = entries.find((e) => e.id === req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json(entry);
  } catch (err) {
    console.error('GET /api/history/:id error:', err.message);
    res.status(500).json({ error: 'Failed to read history' });
  }
});

// DELETE /api/history/:id - remove single entry
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const removed = removeEntry(id, HISTORY_FILE);
    if (!removed) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/history/:id error:', err.message);
    res.status(500).json({ error: 'Failed to remove entry' });
  }
});

// DELETE /api/history with body { clear: true } - clear all
router.delete('/', (req, res) => {
  try {
    const { clear } = req.body || {};
    if (!clear) {
      return res.status(400).json({ error: 'Send { clear: true } to clear all' });
    }
    clearHistory(HISTORY_FILE);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/history clear error:', err.message);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

module.exports = router;
