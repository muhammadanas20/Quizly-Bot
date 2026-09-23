/**
 * src/limiter.js — two tiny in-memory guards.
 *
 *  • createRateLimiter: sliding-window cap on AI calls so a busy group cannot
 *    burn through a free-tier quota in a minute.
 *  • createInflight: one solve per chat at a time. Duplicate "quiz" messages
 *    sent while a solve is running are ignored instead of queued, which is what
 *    keeps latency low on 2 vCPU / 1 GiB.
 *
 * Both are pure JS with an injectable clock, so both are unit-testable.
 */

export function createRateLimiter({ perMinute = 12, perDay = 800, now = () => Date.now() } = {}) {
    const hits = [];

    function prune() {
        const cutoff = now() - 24 * 60 * 60 * 1000;
        let i = 0;
        while (i < hits.length && hits[i] <= cutoff) i++;
        if (i > 0) hits.splice(0, i);
    }

    function stats() {
        prune();
        const minuteAgo = now() - 60 * 1000;
        const inMinute = hits.reduce((n, t) => n + (t > minuteAgo ? 1 : 0), 0);
        return { minute: inMinute, perMinute, day: hits.length, perDay };
    }

    function check() {
        prune();
        const minuteAgo = now() - 60 * 1000;
        const inMinute = hits.reduce((n, t) => n + (t > minuteAgo ? 1 : 0), 0);
        if (inMinute >= perMinute) {
            return { allowed: false, reason: `Per-minute cap reached (${inMinute}/${perMinute}). Wait a minute.` };
        }
        if (hits.length >= perDay) {
            return { allowed: false, reason: `Daily cap reached (${hits.length}/${perDay}). Resets in 24h.` };
        }
        return { allowed: true };
    }

    return {
        check,
        record : () => hits.push(now()),
        stats,
        reset  : () => { hits.length = 0; }
    };
}

export function createInflight() {
    const active = new Map();   // key → startedAt

    return {
        has   : (key) => active.has(key),
        begin : (key) => { if (active.has(key)) return false; active.set(key, Date.now()); return true; },
        end   : (key) => active.delete(key),
        ageOf : (key) => (active.has(key) ? Date.now() - active.get(key) : null),
        size  : () => active.size,
        /** Drop entries older than ttlMs — protects against a crashed solve wedging a chat. */
        sweep : (ttlMs = 5 * 60 * 1000) => {
            const cutoff = Date.now() - ttlMs;
            for (const [k, t] of active) if (t < cutoff) active.delete(k);
        },
        clear : () => active.clear()
    };
}
