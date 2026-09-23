import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/bot-lifecycle.js', import.meta.url));

async function lifecycle(t, scenario) {
    const dir = await mkdtemp(join(tmpdir(), 'quizly-lifecycle-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const { stdout, stderr } = await run(process.execPath, [fixture, scenario, dir], {
        timeout: 15_000
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout.trim());
}

test('515 pairing restart keeps Node alive until the replacement socket opens', async (t) => {
    assert.deepEqual(await lifecycle(t, 'pairing'), { connections: 2, ended: 1 });
});

test('ordinary disconnect keeps Node alive throughout reconnect backoff', async (t) => {
    assert.deepEqual(await lifecycle(t, 'disconnect'), { connections: 2, ended: 1 });
});

test('stop cancels the pending reconnect and allows Node to exit', async (t) => {
    assert.deepEqual(await lifecycle(t, 'stop'), { connections: 1, ended: 1 });
});

test('a replaced session stands down instead of rejoining the kick-war', async (t) => {
    // status 440 = conflict: replaced. A 3s reconnect would only steal the
    // session back from the duplicate, which reclaims it seconds later.
    assert.deepEqual(await lifecycle(t, 'replaced'), { connections: 1, ended: 1 });
});

test('late events from a dead socket cannot spawn a rival connection', async (t) => {
    assert.deepEqual(await lifecycle(t, 'stale'), { connections: 2, ended: 1 });
});
