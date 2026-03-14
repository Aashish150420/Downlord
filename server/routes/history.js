/**
 * GET  /api/history - Return all download history entries
 * DELETE /api/history/:id - Remove entry by id
 * DELETE /api/history - Clear all history (body: { clear: true })
 */

const express = require("express");
const router = express.Router();
const { readHistory, writeHistory } = require("../utils/history");

const HISTORY_FILE = process.env.HISTORY_FILE || "./history.json";

function belongsToUser(entry, userId) {
  return entry && entry.userId && entry.userId === userId;
}

// GET /api/history - list all entries (must be before /:id)
router.get("/", (req, res) => {
  try {
    const userId = req.user?.id;
    const entries = readHistory(HISTORY_FILE);
    const userEntries = entries.filter((entry) => belongsToUser(entry, userId));
    res.json(userEntries);
  } catch (err) {
    console.error("GET /api/history error:", err.message);
    res.status(500).json({ error: "Failed to read history" });
  }
});

// POST /api/history/claim-legacy - assign old unscoped entries to current user
router.post("/claim-legacy", (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const entries = readHistory(HISTORY_FILE);
    let claimed = 0;

    const nextEntries = entries.map((entry) => {
      if (!entry.userId) {
        claimed += 1;
        return { ...entry, userId };
      }
      return entry;
    });

    if (claimed > 0) {
      writeHistory(nextEntries, HISTORY_FILE);
    }

    return res.json({ ok: true, claimed });
  } catch (err) {
    console.error("POST /api/history/claim-legacy error:", err.message);
    return res.status(500).json({ error: "Failed to claim legacy history" });
  }
});

// GET /api/history/:id - get single entry (for re-download)
router.get("/:id", (req, res) => {
  try {
    const userId = req.user?.id;
    const entries = readHistory(HISTORY_FILE);
    const entry = entries.find(
      (e) => e.id === req.params.id && belongsToUser(e, userId),
    );
    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.json(entry);
  } catch (err) {
    console.error("GET /api/history/:id error:", err.message);
    res.status(500).json({ error: "Failed to read history" });
  }
});

// DELETE /api/history/:id - remove single entry
router.delete("/:id", (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const entries = readHistory(HISTORY_FILE);
    const nextEntries = entries.filter(
      (entry) => !(entry.id === id && belongsToUser(entry, userId)),
    );
    if (nextEntries.length === entries.length) {
      return res.status(404).json({ error: "Entry not found" });
    }
    writeHistory(nextEntries, HISTORY_FILE);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/history/:id error:", err.message);
    res.status(500).json({ error: "Failed to remove entry" });
  }
});

// DELETE /api/history with body { clear: true } - clear all
router.delete("/", (req, res) => {
  try {
    const userId = req.user?.id;
    const { clear } = req.body || {};
    if (!clear) {
      return res
        .status(400)
        .json({ error: "Send { clear: true } to clear all" });
    }

    const entries = readHistory(HISTORY_FILE);
    const nextEntries = entries.filter(
      (entry) => !belongsToUser(entry, userId),
    );
    writeHistory(nextEntries, HISTORY_FILE);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/history clear error:", err.message);
    res.status(500).json({ error: "Failed to clear history" });
  }
});

module.exports = router;
