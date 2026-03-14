/**
 * Download queue with concurrency limit and retry logic
 * Prevents server overload and handles transient failures
 */

const DEFAULT_MAX_CONCURRENT = parseInt(
  process.env.MAX_CONCURRENT_DOWNLOADS || "2",
  10,
);
const RETRY_ATTEMPTS = parseInt(process.env.DOWNLOAD_RETRY_ATTEMPTS || "2", 10);
const RETRY_DELAY_MS = parseInt(
  process.env.DOWNLOAD_RETRY_DELAY_MS || "3000",
  10,
);

let maxConcurrent = Number.isFinite(DEFAULT_MAX_CONCURRENT)
  ? Math.max(1, DEFAULT_MAX_CONCURRENT)
  : 2;

let activeCount = 0;
const waitQueue = [];

function runNext() {
  if (activeCount >= maxConcurrent || waitQueue.length === 0) return;
  const job = waitQueue.shift();
  activeCount++;
  job().finally(() => {
    activeCount--;
    runNext();
  });
}

/**
 * Execute a download job with queue and retry
 * @param {Function} jobFn - Async function that performs the download
 * @returns {Promise}
 */
function enqueue(jobFn) {
  return new Promise((resolve, reject) => {
    const wrapped = async () => {
      let lastErr;
      for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
        try {
          const result = await jobFn();
          resolve(result);
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < RETRY_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }
      reject(lastErr);
    };
    wrapped.reject = reject;
    waitQueue.push(wrapped);
    runNext();
  });
}

/**
 * Get current queue status
 */
function getStatus() {
  return { active: activeCount, queued: waitQueue.length, maxConcurrent };
}

function setMaxConcurrent(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("maxConcurrent must be a positive integer");
  }
  maxConcurrent = parsed;
  runNext();
  return maxConcurrent;
}

function getMaxConcurrent() {
  return maxConcurrent;
}

module.exports = {
  enqueue,
  getStatus,
  setMaxConcurrent,
  getMaxConcurrent,
  DEFAULT_MAX_CONCURRENT,
};
