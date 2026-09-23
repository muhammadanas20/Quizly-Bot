import test from 'node:test';
import assert from 'node:assert/strict';

import { createGroupCache } from '../src/groups.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const ME = '923001234567:5@s.whatsapp.net';

function make({ participants, fails = false, ttlMs = 1000 } = {}) {
    let calls = 0;
    const sock = {
        groupMetadata: async () => {
            calls++;
            if (fails) throw new Error('404 not in group');
            return { id: GROUP, subject: 'Study Group', participants };
        }
    };
    const cache = createGroupCache({ sock, getMe: () => ME, log, ttlMs });
    return { cache, calls: () => calls };
}

test('isAdmin: true when the bot is listed as admin', async () => {
    const { cache } = make({
        participants: [
            { id: '923009999999@s.whatsapp.net', admin: null },
            { id: '923001234567@s.whatsapp.net', admin: 'admin' }
        ]
    });
    assert.equal(await cache.isAdmin(GROUP), true);
});

test('isAdmin: true for a superadmin / group owner', async () => {
    const { cache } = make({ participants: [{ id: '923001234567@s.whatsapp.net', admin: 'superadmin' }] });
    assert.equal(await cache.isAdmin(GROUP), true);

    const { cache: c2 } = make({ participants: [{ id: '923009999999@s.whatsapp.net', admin: null }] });
    // owner is not automatically admin in the metadata we build, so check the plain case too
    assert.equal(await c2.isAdmin(GROUP), false);
});

test('isAdmin: false when the bot is an ordinary member', async () => {
    const { cache } = make({ participants: [{ id: '923001234567@s.whatsapp.net', admin: null }] });
    assert.equal(await cache.isAdmin(GROUP), false);
});

test('isAdmin: matches the bot even when the list uses a device suffix or LID', async () => {
    const { cache } = make({ participants: [{ id: '923001234567:11@s.whatsapp.net', admin: 'admin' }] });
    assert.equal(await cache.isAdmin(GROUP), true);

    const { cache: c2 } = make({
        participants: [{ id: '555@lid', phoneNumber: '923001234567', admin: 'admin' }]
    });
    assert.equal(await c2.isAdmin(GROUP), true);
});

test('isAdmin: a metadata failure resolves to unknown and is not cached as false', async () => {
    const { cache, calls } = make({ fails: true });
    assert.equal(await cache.isAdmin(GROUP), 'unknown');
    assert.equal(await cache.isAdmin(GROUP), 'unknown');
    assert.equal(calls(), 2, 'a failed lookup must be retried, never remembered as "not admin"');
});

test('caching: repeated checks hit the network once inside the TTL', async () => {
    const { cache, calls } = make({ participants: [{ id: '923001234567@s.whatsapp.net', admin: 'admin' }] });
    await cache.isAdmin(GROUP);
    await cache.isAdmin(GROUP);
    await cache.isAdmin(GROUP);
    assert.equal(calls(), 1);
});

test('caching: invalidate forces a refresh (used on membership change)', async () => {
    const { cache, calls } = make({ participants: [{ id: '923001234567@s.whatsapp.net', admin: 'admin' }] });
    await cache.isAdmin(GROUP);
    cache.invalidate(GROUP);
    await cache.isAdmin(GROUP);
    assert.equal(calls(), 2);
});

test('caching: entries expire after the TTL', async () => {
    const { cache, calls } = make({ participants: [], ttlMs: 1 });
    await cache.isAdmin(GROUP);
    await new Promise((r) => setTimeout(r, 5));
    await cache.isAdmin(GROUP);
    assert.equal(calls(), 2);
});

test('subjectOf returns the cached group name for logs', async () => {
    const { cache } = make({ participants: [] });
    await cache.isAdmin(GROUP);
    assert.equal(cache.subjectOf(GROUP), 'Study Group');
    assert.equal(cache.subjectOf('other@g.us'), '');
});
