import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createInstanceLock } from '../src/lock.js';

const log = Object.fromEntries(
    ['info', 'warn', 'error', 'fatal', 'debug', 'raw'].map((level) => [level, () => {}])
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pidIn = async (file) => Number.parseInt(await readFile(file, 'utf8'), 10);

async function tmpLock(t) {
    const dir = await mkdtemp(join(tmpdir(), 'quizly-lock-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return join(dir, 'instance.lock');
}

test('tryAcquire claims the lock and a live holder blocks a second copy', async (t) => {
    const file = await tmpLock(t);
    const first = createInstanceLock({ file, log });
    const second = createInstanceLock({ file, log });

    assert.equal(first.tryAcquire(), true);
    assert.equal(await pidIn(file), process.pid);
    // The holder (this very process) is alive — the second copy must back off.
    assert.equal(second.tryAcquire(), false);

    first.release();
    assert.equal(second.tryAcquire(), true);
    second.release();
    await assert.rejects(access(file)); // released lock is gone
});

test('a stale lock from a crashed copy is taken over', async (t) => {
    const file = await tmpLock(t);
    await writeFile(file, '99999999'); // no such pid survives
    const lock = createInstanceLock({ file, log });
    assert.equal(lock.tryAcquire(), true);
    assert.equal(await pidIn(file), process.pid);
    lock.release();
});

test('acquire waits for the holder and takes over once it exits', async (t) => {
    const file = await tmpLock(t);
    await writeFile(file, String(process.pid)); // a "live" holder
    const lock = createInstanceLock({ file, log, pollMs: 50 });

    let settled = null;
    const waiting = lock.acquire().then((v) => { settled = v; return v; });
    await sleep(180);
    assert.equal(settled, null); // still waiting while the holder lives

    await rm(file);              // holder exits
    assert.equal(await waiting, true);
    lock.release();
});

test('cancel aborts the wait so shutdown is never blocked', async (t) => {
    const file = await tmpLock(t);
    await writeFile(file, String(process.pid));
    const lock = createInstanceLock({ file, log, pollMs: 50 });

    const waiting = lock.acquire();
    await sleep(80);
    lock.cancel();
    assert.equal(await waiting, false);
});

test('release never deletes a lock that now belongs to someone else', async (t) => {
    const file = await tmpLock(t);
    const lock = createInstanceLock({ file, log });
    lock.tryAcquire();
    await writeFile(file, '99999999'); // another copy has since claimed it
    lock.release();
    await access(file);                // still present — not ours to remove
});
