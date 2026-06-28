/**
 * rateLimiter.js
 *
 * Tracks Groq API usage to stay within free-tier limits.
 *
 * Groq free-tier limits (conservative — varies by model):
 *   - ~30 requests per minute
 *   - ~14,400 requests per day
 *
 * Soft limits are set below each hard limit to keep a buffer.
 * If Groq raises a 429, lower PER_MINUTE further.
 * Check your actual limits at: https://console.groq.com/settings/limits
 */

const LIMITS = {
    PER_MINUTE : 28,    // buffer under the ~30/min hard limit
    PER_DAY    : 14000  // buffer under the ~14,400/day hard limit
};

// In-memory array of request timestamps (Unix ms).
// Resets if the process restarts — acceptable for this use case.
const requestLog = [];

// ─── Internal: remove timestamps older than 24 hours ─────────────────────────
function cleanup() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let i = 0;
    while (i < requestLog.length && requestLog[i] <= cutoff) i++;
    if (i > 0) requestLog.splice(0, i);
}

// ─── Check whether a new request is allowed ───────────────────────────────────
// Returns { allowed: true } or { allowed: false, reason: "..." }
function checkRateLimit() {
    cleanup();

    const now          = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    const inLastMinute = requestLog.filter(t => t > oneMinuteAgo).length;
    const inLastDay    = requestLog.length;

    if (inLastMinute >= LIMITS.PER_MINUTE) {
        return {
            allowed : false,
            reason  : `Per-minute cap hit (${inLastMinute}/${LIMITS.PER_MINUTE} in last 60s). Wait ~1 minute.`
        };
    }

    if (inLastDay >= LIMITS.PER_DAY) {
        return {
            allowed : false,
            reason  : `Daily quota exhausted (${inLastDay}/${LIMITS.PER_DAY} today). Resets at midnight UTC.`
        };
    }

    return { allowed: true };
}

// ─── Record a successful request ─────────────────────────────────────────────
function recordRequest() {
    requestLog.push(Date.now());
}

// ─── Return current usage for console logging ─────────────────────────────────
function getStats() {
    cleanup();
    const now          = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const inLastMinute = requestLog.filter(t => t > oneMinuteAgo).length;

    return {
        lastMinute : `${inLastMinute}/${LIMITS.PER_MINUTE}`,
        lastDay    : `${requestLog.length}/${LIMITS.PER_DAY}`
    };
}

module.exports = { checkRateLimit, recordRequest, getStats };
