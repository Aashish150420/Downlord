/**
 * Simple read/write for history.json
 * Stores download history as a JSON array.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Get full path to history file
 * @param {string} historyFile - Path from env (e.g. ./history.json)
 * @returns {string}
 */
function getHistoryPath(historyFile) {
  return path.resolve(process.cwd(), historyFile || './history.json');
}

/**
 * Read history from JSON file
 * @param {string} historyFile - Path to history.json
 * @returns {Array} - Array of history entries
 */
function readHistory(historyFile) {
  const filePath = getHistoryPath(historyFile);
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Write history to JSON file
 * @param {Array} entries - Array of history entries
 * @param {string} historyFile - Path to history.json
 */
function writeHistory(entries, historyFile) {
  const filePath = getHistoryPath(historyFile);
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf8');
}

/**
 * Add a new history entry
 * @param {object} entry - { title, url, format, quality, filename, status }
 * @param {string} historyFile - Path to history.json
 * @returns {object} - Entry with id and date added
 */
function addEntry(entry, historyFile) {
  const entries = readHistory(historyFile);
  const newEntry = {
    id: uuidv4(),
    title: entry.title || 'Unknown',
    url: entry.url || '',
    format: entry.format || 'mp4',
    quality: entry.quality || 'best',
    audioBitrate: entry.audioBitrate || null,
    filenameTemplate: entry.filenameTemplate || null,
    subtitleLangs: entry.subtitleLangs || null,
    site: entry.site || null,
    date: new Date().toISOString(),
    status: entry.status || 'completed',
    filename: entry.filename || null,
    // Stored for re-download
    subtitles: entry.subtitles || false,
    removeWatermark: entry.removeWatermark || false,
    isPlaylist: entry.isPlaylist || false,
  };
  entries.unshift(newEntry);
  writeHistory(entries, historyFile);
  return newEntry;
}

/**
 * Remove entry by id
 * @param {string} id - Entry id
 * @param {string} historyFile - Path to history.json
 * @returns {boolean} - True if removed
 */
function removeEntry(id, historyFile) {
  const entries = readHistory(historyFile);
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length === entries.length) return false;
  writeHistory(filtered, historyFile);
  return true;
}

/**
 * Clear all history
 * @param {string} historyFile - Path to history.json
 */
function clearHistory(historyFile) {
  writeHistory([], historyFile);
}

module.exports = {
  readHistory,
  writeHistory,
  addEntry,
  removeEntry,
  clearHistory,
};
