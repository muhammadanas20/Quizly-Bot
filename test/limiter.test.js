import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, createInflight } from '../src/limiter.js';

test('rateLimiter: allows up to the per-minute cap, then refuses', () => {
    let t = 0;
    const rl = createRateLimiter({ perMinute: 3, perDay: 100, now: () => t });

    for (let i = 0; i < 3; i++) {
        assert.equal(rl.check().allowed, true);
        rl.record();
    }
    const blocked = rl.check();
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /Per-minute cap/);
});

test('rateLimiter: the window slides, so waiting frees capacity', () => {
    let t = 0;
    const rl = createRateLimiter({ perMinute: 2, perDay: 100, now: () => t });
    rl.record(); rl.record();
    assert.equal(rl.check().allowed, false);

    t += 61_000;
    assert.equal(rl.check().allowed, true);
});

test('rateLimiter: the daily cap still applies after the minute resets', () => {
    let t = 0;
    const rl = createRateLimiter({ perMinute: 100, perDay: 2, now: () => t });
    rl.record();
    t += 61_000; rl.record();
    const blocked = rl.check();
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /Daily cap/);
});

test('rateLimiter: old entries are pruned, the array cannot grow forever', () => {
    let t = 0;
    const rl = createRateLimiter({ perMinute: 1000, perDay: 1000, now: () => t });
    for (let i = 0; i < 50; i++) rl.record();
    t += 25 * 60 * 60 * 1000;         // 25 hours later
    rl.check();
    assert.deepEqual(rl.stats(), { minute: 0, perMinute: 1000, day: 0, perDay: 1000 });
});

test('rateLimiter: reset clears everything', () => {
    const rl = createRateLimiter({ perMinute: 1, perDay: 1 });
    rl.record();
    assert.equal(rl.check().allowed, false);
    rl.reset();
    assert.equal(rl.check().allowed, true);
});

test('inflight: one job per key, and end() frees it', () => {
    const q = createInflight();
    assert.equal(q.begin('g1'), true);
    assert.equal(q.begin('g1'), false, 'second start on the same chat is refused');
    assert.equal(q.begin('g2'), true,  'a different chat is independent');
    assert.equal(q.size(), 2);

    q.end('g1');
    assert.equal(q.has('g1'), false);
    assert.equal(q.begin('g1'), true);
});

test('inflight: sweep clears entries that a crashed solve left behind', () => {
    const q = createInflight();
    q.begin('g1');
    // rewind the stored timestamp so it looks ancient
    q.sweep(-1);
    assert.equal(q.has('g1'), false);
});
