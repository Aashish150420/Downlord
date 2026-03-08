/**
 * Download queue with concurrency limit and retry logic
 * Prevents server overload and handles transient failures
 */

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '2', 10);
const RETRY_ATTEMPTS = parseInt(process.env.DOWNLOAD_RETRY_ATTEMPTS || '2', 10);
const RETRY_DELAY_MS = parseInt(process.env.DOWNLOAD_RETRY_DELAY_MS || '3000', 10);

let activeCount = 0;
const waitQueue = [];

function runNext() {
  if (activeCount >= MAX_CONCURRENT || waitQueue.length === 0) return;
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
  return { active: activeCount, queued: waitQueue.length };
}

module.exports = { enqueue, getStatus, MAX_CONCURRENT };
