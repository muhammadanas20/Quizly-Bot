import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decide, collectSenderIds, createGuard } from '../src/guard.js';
import { createFlagStore } from '../src/flags.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const USER = '923001234567@s.whatsapp.net';

const store = () => createFlagStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g-')), 'f.json') });

const base = (over = {}) => ({
    kind        : 'sticker',
    senderIds   : new Set(['923001234567']),
    guardEnabled: true,
    isGroup     : true,
    fromMe      : false,
    whitelist   : new Set(),
    blocked     : ['sticker'],
    flags       : { find: (ids) => ({ key: '923001234567', entry: { keys: [...ids], label: 'Ali', media: null } }) },
    botIsAdmin  : true,
    ...over
});

// ── the decision matrix ──────────────────────────────────────────────────────
test('decide: flagged sticker in a group where the bot is admin → delete', () => {
    assert.equal(decide(base()).act, 'delete');
});

test('decide: unknown admin state still deletes (cold cache must not leak a sticker)', () => {
    assert.equal(decide(base({ botIsAdmin: 'unknown' })).act, 'delete');
});

test('decide: bot is NOT admin → skip, WhatsApp would reject the revoke anyway', () => {
    const d = decide(base({ botIsAdmin: false }));
    assert.equal(d.act, 'skip');
    assert.equal(d.reason, 'bot-not-admin');
});

test('decide: not flagged → skip', () => {
    const d = decide(base({ flags: { find: () => null } }));
    assert.equal(d.act, 'skip');
    assert.equal(d.reason, 'not-flagged');
});

test('decide: private chat → skip (the guard is group-only)', () => {
    assert.equal(decide(base({ isGroup: false })).reason, 'not-a-group');
});

test('decide: the bot never deletes its own message', () => {
    assert.equal(decide(base({ fromMe: true })).reason, 'own-message');
});

test('decide: guard switched off → skip', () => {
    assert.equal(decide(base({ guardEnabled: false })).reason, 'guard-off');
});

test('decide: whitelisted number is never touched', () => {
    const d = decide(base({ whitelist: new Set(['923001234567']) }));
    assert.equal(d.act, 'skip');
    assert.equal(d.reason, 'whitelisted');
});

test('decide: only the configured media kinds are removed', () => {
    assert.equal(decide(base({ kind: 'image' })).reason, 'kind-allowed:image');
    assert.equal(decide(base({ kind: 'image', blocked: ['sticker', 'image'] })).act, 'delete');
    assert.equal(decide(base({ kind: 'link', blocked: ['all'] })).act, 'delete');
});

test('decide: a per-user media override beats the global setting', () => {
    const flags = { find: (ids) => ({ key: 'x', entry: { keys: [...ids], media: ['sticker', 'link'] } }) };
    assert.equal(decide(base({ kind: 'link', blocked: ['sticker'], flags })).act, 'delete');
    assert.equal(decide(base({ kind: 'image', blocked: ['sticker'], flags })).act, 'skip');
});

test('decide: system messages and reactions are never revoked', () => {
    for (const kind of ['system', 'reaction', 'unknown']) {
        assert.equal(decide(base({ kind })).act, 'skip');
    }
});

// ── identity collection (Baileys 7 LID handling) ─────────────────────────────
test('collectSenderIds: gathers participant + participantAlt', () => {
    const ids = collectSenderIds({ key: { participant: USER, participantAlt: '555@lid' } }, {});
    assert.ok(ids.has('923001234567'));
    assert.ok(ids.has('555@lid'));
});

test('collectSenderIds: resolves a LID to its phone number when the mapping is known', () => {
    const sock = { signalRepository: { lidMapping: { getPNForLID: (lid) => (lid === '555@lid' ? `${USER}` : undefined) } } };
    const ids = collectSenderIds({ key: { participant: '555@lid' } }, sock);
    assert.ok(ids.has('555@lid'));
    assert.ok(ids.has('923001234567'), 'phone-number identity should be derived from the LID');
});

test('collectSenderIds: survives a missing or throwing mapping store', () => {
    assert.doesNotThrow(() => collectSenderIds({ key: { participant: '555@lid' } }, {}));
    const boom = { signalRepository: { get lidMapping() { throw new Error('nope'); } } };
    assert.doesNotThrow(() => collectSenderIds({ key: { participant: '555@lid' } }, boom));
});

// ── the live guard ───────────────────────────────────────────────────────────
function makeWorld({ guardMedia = 'sticker', flagged = true, admin = true, whitelist = '' } = {}) {
    const sent = [];
    const flags = store();
    if (flagged) flags.add(new Set(['923001234567']), { label: 'Ali' });

    const config = loadConfig({
        GUARD_MEDIA     : guardMedia,
        GUARD_WHITELIST : whitelist,
        GEMINI_API_KEY  : 'k'
    });

    const sock = {
        sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'X' } }; },
        signalRepository: { lidMapping: { getPNForLID: () => undefined } }
    };

    const guard = createGuard({ sock, flags, config, log, isAdmin: async () => admin });
    return { guard, sent, flags, config };
}

const stickerMsg = {
    key    : { remoteJid: GROUP, participant: USER, fromMe: false, id: 'MSG1' },
    message: { stickerMessage: { url: 'u', mimetype: 'image/webp' } }
};

test('guard: deletes the sticker and sends NO message into the group', async () => {
    const { guard, sent } = makeWorld();
    const verdict = await guard.handle(stickerMsg);

    assert.equal(verdict.act, 'delete');
    assert.equal(sent.length, 1, 'exactly one WhatsApp call');
    assert.deepEqual(sent[0].content, { delete: stickerMsg.key }, 'it must be a revoke, not a text reply');
    assert.equal(sent[0].jid, GROUP);
    assert.equal(guard.stats.deleted, 1);
    // no text was ever produced for the group
    assert.equal(sent.some((s) => s.content.text !== undefined), false);
});

test('guard: ignores an unflagged sender without calling the socket at all', async () => {
    const { guard, sent } = makeWorld();
    const msg = { ...stickerMsg, key: { ...stickerMsg.key, participant: '923009999999@s.whatsapp.net' } };
    assert.equal(await guard.handle(msg), null);
    assert.equal(sent.length, 0);
});

test('guard: a flagged member\'s plain text message is left alone', async () => {
    const { guard, sent } = makeWorld();
    const msg = { key: stickerMsg.key, message: { conversation: 'hello' } };
    const verdict = await guard.handle(msg);
    assert.equal(verdict.act, 'skip');
    assert.equal(verdict.reason, 'kind-allowed:text');
    assert.equal(sent.length, 0);
});

test('guard: does nothing when the bot is not an admin, and counts it', async () => {
    const { guard, sent } = makeWorld({ admin: false });
    const verdict = await guard.handle(stickerMsg);
    assert.equal(verdict.act, 'skip');
    assert.equal(sent.length, 0);
    assert.equal(guard.stats.skippedNotAdmin, 1);
});

test('guard: only stickers by default; images pass through', async () => {
    const { guard, sent } = makeWorld();
    const imageMsg = { key: stickerMsg.key, message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } } };
    const verdict = await guard.handle(imageMsg);
    assert.equal(verdict.act, 'skip');
    assert.equal(sent.length, 0);
});

test('guard: GUARD_MEDIA=all removes images too', async () => {
    const { guard, sent } = makeWorld({ guardMedia: 'all' });
    const imageMsg = { key: stickerMsg.key, message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } } };
    assert.equal((await guard.handle(imageMsg)).act, 'delete');
    assert.equal(sent.length, 1);
});

test('guard: whitelisted number keeps its stickers', async () => {
    const { guard, sent } = makeWorld({ whitelist: '923001234567' });
    assert.equal((await guard.handle(stickerMsg)).act, 'skip');
    assert.equal(sent.length, 0);
});

test('guard: repeated stickers accumulate per-user counters', async () => {
    const { guard, flags } = makeWorld();
    await guard.handle(stickerMsg);
    await guard.handle({ ...stickerMsg, key: { ...stickerMsg.key, id: 'MSG2' } });
    assert.equal(guard.stats.deleted, 2);
    assert.equal(guard.stats.byUser.get('Ali'), 2);
    assert.equal(flags.find(new Set(['923001234567'])).entry.deleted, 2);
});

test('guard: a flagged LID-only sender is still caught', async () => {
    const { guard, sent, flags } = makeWorld({ flagged: false });
    flags.add(new Set(['555@lid']), { label: 'Ali-by-lid' });
    const msg = { key: { ...stickerMsg.key, participant: '555@lid' }, message: stickerMsg.message };
    assert.equal((await guard.handle(msg)).act, 'delete');
    assert.equal(sent.length, 1);
});

test('guard: learns the phone number of a LID-flagged member, so !unflag by number works', async () => {
    const { guard, flags } = makeWorld({ flagged: false });
    flags.add(new Set(['555@lid']), { label: 'Ali-by-lid' });

    const msg = {
        key    : { remoteJid: GROUP, participant: '923001234567@s.whatsapp.net', participantAlt: '555@lid', fromMe: false, id: 'MSG9' },
        message: stickerMsg.message
    };
    assert.equal((await guard.handle(msg)).act, 'delete');

    // the entry now answers to the phone number as well
    assert.equal(flags.has(new Set(['923001234567'])), true, 'the new identity was aliased onto the entry');
    assert.equal(flags.has(new Set(['555@lid'])), true, 'the original identity still resolves');
});

test('guard: tolerates a malformed message object', async () => {
    const { guard, sent } = makeWorld();
    assert.doesNotThrow(async () => { await guard.handle({}); await guard.handle(null); });
    assert.equal(sent.length, 0);
});
