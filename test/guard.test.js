import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decide, collectSenderIds, createGuard, withheldViewOnceKey } from '../src/guard.js';
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
    blocked     : ['sticker', 'image'],
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
    assert.equal(decide(base({ kind: 'image', blocked: ['sticker'] })).reason, 'kind-allowed:image');
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

// ── one-time ("view once") media WhatsApp withheld ───────────────────────────
// A web-class linked device never receives the media, so all the guard gets is
// `key.isViewOnce` and a kind of 'viewonce'. It must still be revoked.
test('decide: withheld one-time media is removed under any photo/video/audio rule', () => {
    for (const blocked of [['sticker', 'image'], ['image'], ['video'], ['audio'], ['all'], ['viewonce']]) {
        assert.equal(decide(base({ kind: 'viewonce', blocked })).act, 'delete', `blocked=${blocked}`);
    }
});

test('decide: a stickers-only policy leaves withheld one-time media alone', () => {
    const d = decide(base({ kind: 'viewonce', blocked: ['sticker'] }));
    assert.equal(d.act, 'skip');
    assert.equal(d.reason, 'kind-allowed:viewonce');
});

test('decide: a per-user media override also decides one-time media', () => {
    const flags = { find: () => ({ key: 'x', entry: { keys: ['x'], media: ['sticker'] } }) };
    assert.equal(decide(base({ kind: 'viewonce', flags })).reason, 'kind-allowed:viewonce');
});

test('decide: withheld one-time media still respects every other rule', () => {
    assert.equal(decide(base({ kind: 'viewonce', isGroup: false })).reason, 'not-a-group');
    assert.equal(decide(base({ kind: 'viewonce', fromMe: true })).reason, 'own-message');
    assert.equal(decide(base({ kind: 'viewonce', guardEnabled: false })).reason, 'guard-off');
    assert.equal(decide(base({ kind: 'viewonce', whitelist: new Set(['923001234567']) })).reason, 'whitelisted');
    assert.equal(decide(base({ kind: 'viewonce', flags: { find: () => null } })).reason, 'not-flagged');
    assert.equal(decide(base({ kind: 'viewonce', botIsAdmin: false })).reason, 'bot-not-admin');
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
function makeWorld({ guardMedia, flagged = true, admin = true, whitelist = '' } = {}) {
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

test('guard: photos, including view-once photos, are deleted by default', async () => {
    const { guard, sent } = makeWorld();
    const imageMsg = {
        key: { ...stickerMsg.key, id: 'IMG1' },
        message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } }
    };
    const viewOnceMsg = {
        key: { ...stickerMsg.key, id: 'IMG2' },
        message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } } } }
    };

    assert.equal((await guard.handle(imageMsg)).act, 'delete');
    assert.equal((await guard.handle(viewOnceMsg)).act, 'delete');
    assert.deepEqual(sent.map((s) => s.content.delete.id), ['IMG1', 'IMG2']);
});

test('guard: removes a one-time message whose media WhatsApp withheld', async () => {
    const { guard, sent, flags } = makeWorld();

    // Exactly what Baileys delivers a web-class companion for a view-once
    // message: `key.isViewOnce` set, and no message body whatsoever.
    const withheld = {
        key    : { remoteJid: GROUP, participant: USER, fromMe: false, id: 'VO1', isViewOnce: true }
    };

    const verdict = await guard.handle(withheld);

    assert.equal(verdict.act, 'delete', 'the revoke must still happen without the media');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].content, { delete: withheld.key });
    assert.equal(sent[0].jid, GROUP);
    assert.equal(guard.stats.deleted, 1);
    assert.equal(guard.stats.viewOnce, 1);
    assert.equal(flags.find(new Set(['923001234567'])).entry.deleted, 1);
});

test('guard: a withheld one-time message survives a stickers-only policy', async () => {
    const { guard, sent } = makeWorld({ guardMedia: 'sticker' });
    const withheld = { key: { remoteJid: GROUP, participant: USER, fromMe: false, id: 'VO2', isViewOnce: true } };
    assert.equal((await guard.handle(withheld)).reason, 'kind-allowed:viewonce');
    assert.equal(sent.length, 0);
});

test('guard: an unflagged sender\'s one-time message is untouched', async () => {
    const { guard, sent } = makeWorld();
    const withheld = { key: { remoteJid: GROUP, participant: '923009999999@s.whatsapp.net', fromMe: false, id: 'VO3', isViewOnce: true } };
    assert.equal(await guard.handle(withheld), null);
    assert.equal(sent.length, 0);
});

test('guard: GUARD_MEDIA=sticker keeps photos allowed', async () => {
    const { guard, sent } = makeWorld({ guardMedia: 'sticker' });
    const viewOnceMsg = {
        key: stickerMsg.key,
        message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } } } }
    };
    assert.equal((await guard.handle(viewOnceMsg)).reason, 'kind-allowed:image');
    assert.equal(sent.length, 0);
});

test('guard: GUARD_MEDIA=all removes videos too', async () => {
    const { guard, sent } = makeWorld({ guardMedia: 'all' });
    const videoMsg = { key: stickerMsg.key, message: { videoMessage: { url: 'u' } } };
    assert.equal((await guard.handle(videoMsg)).act, 'delete');
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

// ── raw-stanza sweep (the current wire shape) ────────────────────────────────
// Baileys rc14 discards `<unavailable type="view_once_unavailable_fanout"/>`
// messages before `messages.upsert`, so the guard must revoke them from the raw
// `CB:message` stanza event, which fires first.
const stanza = (over = {}) => ({
    tag  : 'message',
    attrs: { id: 'VOX1', from: GROUP, participant: USER, t: '1700000000' },
    content: [{ tag: 'unavailable', attrs: { type: 'view_once_unavailable_fanout' } }],
    ...over
});

const tick = () => new Promise((r) => setTimeout(r, 20));

test('withheldViewOnceKey: extracts the revoke key from a withheld stanza', () => {
    assert.deepEqual(withheldViewOnceKey(stanza()), { remoteJid: GROUP, participant: USER, id: 'VOX1' });
});

test('withheldViewOnceKey: ignores everything that is not a withheld one-time group message', () => {
    assert.equal(withheldViewOnceKey(stanza({ content: [{ tag: 'enc', attrs: { type: 'pkmsg' } }] })), null);
    assert.equal(withheldViewOnceKey(stanza({ content: [{ tag: 'unavailable', attrs: { type: 'bot_unavailable_fanout' } }] })), null);
    assert.equal(withheldViewOnceKey(stanza({ attrs: { id: 'X', from: '923001234567@s.whatsapp.net', participant: USER } })), null, 'private chat');
    assert.equal(withheldViewOnceKey({ tag: 'notification', attrs: {}, content: [] }), null);
    assert.equal(withheldViewOnceKey(undefined), null);
});

test('sweep: revokes a flagged member\'s withheld one-time message from the raw stanza', async () => {
    const { guard, sent } = makeWorld();
    const ws = new EventEmitter();
    guard.attach({ ws });

    ws.emit('CB:message', stanza());
    await tick();

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].content.delete, { remoteJid: GROUP, participant: USER, id: 'VOX1', fromMe: false });
    assert.equal(sent[0].jid, GROUP);
    assert.equal(guard.stats.deleted, 1);
    assert.equal(guard.stats.viewOnce, 1);
});

test('sweep: same message id is only revoked once (realtime + offline batch)', async () => {
    const { guard, sent } = makeWorld();
    const ws = new EventEmitter();
    guard.attach({ ws });

    ws.emit('CB:message', stanza());
    // offline batch: the same stanza wrapped in a notification envelope
    ws.emit('CB:notification', { tag: 'notification', attrs: { type: 'offline' }, content: [stanza()] });
    await tick();

    assert.equal(sent.length, 1, 'no double revoke');
});

test('sweep: leaves unflagged senders, whitelists and non-admin groups alone', async () => {
    const unflagged = makeWorld();
    unflagged.guard.attach({ ws: unflagged.ws = new EventEmitter() });
    unflagged.ws.emit('CB:message', stanza({ attrs: { id: 'A', from: GROUP, participant: '923009999999@s.whatsapp.net' } }));

    const wl = makeWorld({ whitelist: '923001234567' });
    wl.guard.attach({ ws: wl.ws = new EventEmitter() });
    wl.ws.emit('CB:message', stanza({ attrs: { id: 'B', from: GROUP, participant: USER } }));

    const notAdmin = makeWorld({ admin: false });
    notAdmin.guard.attach({ ws: notAdmin.ws = new EventEmitter() });
    notAdmin.ws.emit('CB:message', stanza({ attrs: { id: 'C', from: GROUP, participant: USER } }));

    await tick();
    assert.equal(unflagged.sent.length, 0);
    assert.equal(wl.sent.length, 0);
    assert.equal(notAdmin.sent.length, 0);
    assert.equal(notAdmin.guard.stats.skippedNotAdmin, 1);
});

test('sweep: attach is a no-op on sockets without a raw ws emitter', async () => {
    const { guard, sent } = makeWorld();
    assert.doesNotThrow(() => guard.attach({}));
    assert.doesNotThrow(() => guard.attach(undefined));
    await tick();
    assert.equal(sent.length, 0);
});
