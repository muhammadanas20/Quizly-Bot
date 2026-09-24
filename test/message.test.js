import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyKind, extractText, containsTrigger, getQuoted, unwrap, bareJid, isGroupJid, isVisual, isViewOnce } from '../src/message.js';

const sticker = { stickerMessage: { url: 'x', mimetype: 'image/webp' } };
const animatedSticker = { stickerMessage: { url: 'x', isAnimated: true } };
const image = { imageMessage: { url: 'x', mimetype: 'image/jpeg', caption: 'quiz please' } };
const gif = { videoMessage: { url: 'x', gifPlayback: true } };
const video = { videoMessage: { url: 'x' } };
const doc = { documentMessage: { url: 'x', mimetype: 'application/pdf' } };
const audio = { audioMessage: { url: 'x' } };
const text = { conversation: 'hello there' };
const link = { extendedTextMessage: { text: 'look https://example.com/a' } };
const reaction = { reactionMessage: { text: '👍' } };

test('classifyKind: recognises every media type', () => {
    assert.equal(classifyKind(sticker), 'sticker');
    assert.equal(classifyKind(animatedSticker), 'sticker');
    assert.equal(classifyKind(image), 'image');
    assert.equal(classifyKind(gif), 'gif');
    assert.equal(classifyKind(video), 'video');
    assert.equal(classifyKind(doc), 'document');
    assert.equal(classifyKind(audio), 'audio');
    assert.equal(classifyKind(text), 'text');
    assert.equal(classifyKind(link), 'link');
    assert.equal(classifyKind(reaction), 'reaction');
    assert.equal(classifyKind(undefined), 'unknown');
});

test('classifyKind: sees through viewOnce / ephemeral envelopes', () => {
    assert.equal(classifyKind({ viewOnceMessage: { message: sticker } }), 'sticker');
    assert.equal(classifyKind({ viewOnceMessageV2: { message: image } }), 'image');
    assert.equal(classifyKind({ viewOnceMessageV2Extension: { message: image } }), 'image');
    assert.equal(classifyKind({ ephemeralMessage: { message: { viewOnceMessageV2: { message: image } } } }), 'image');
});

// ── one-time ("view once") media ─────────────────────────────────────────────
// The shape that matters most is the one a web-class linked device gets:
// WhatsApp refuses to send the media, Baileys marks `key.isViewOnce` and there
// is no message body at all.
test('isViewOnce: the key flag alone marks a one-time message with no body', () => {
    assert.equal(isViewOnce(undefined, { isViewOnce: true }), true);
    assert.equal(isViewOnce({}, { isViewOnce: true }), true);
});

test('isViewOnce: wrappers, flat media flags and disappearing-message nesting', () => {
    assert.equal(isViewOnce({ viewOnceMessage: { message: image } }), true);
    assert.equal(isViewOnce({ viewOnceMessageV2: { message: image } }), true);
    assert.equal(isViewOnce({ viewOnceMessageV2Extension: { message: audio } }), true);
    assert.equal(isViewOnce({ ephemeralMessage: { message: { viewOnceMessageV2: { message: image } } } }), true);
    assert.equal(isViewOnce({ imageMessage: { url: 'x', viewOnce: true } }), true);
    assert.equal(isViewOnce({ videoMessage: { url: 'x', viewOnce: true } }), true);
});

test('isViewOnce: ordinary messages are not one-time messages', () => {
    assert.equal(isViewOnce(image), false);
    assert.equal(isViewOnce(sticker), false);
    assert.equal(isViewOnce(text), false);
    assert.equal(isViewOnce(undefined, {}), false);
    assert.equal(isViewOnce(undefined, undefined), false);
});

test('classifyKind: withheld one-time media is "viewonce", not "unknown"', () => {
    // Baileys hands us exactly this for a web-class companion
    assert.equal(classifyKind(undefined, { isViewOnce: true }), 'viewonce');
    assert.equal(classifyKind({ viewOnceMessageV2: { message: null } }), 'viewonce');
    assert.equal(classifyKind({ viewOnceMessage: {} }, { isViewOnce: true }), 'viewonce');
});

test('classifyKind: one-time media that DID arrive keeps its real kind', () => {
    assert.equal(classifyKind({ viewOnceMessageV2: { message: image } }), 'image');
    assert.equal(classifyKind({ viewOnceMessageV2: { message: video } }), 'video');
});

test('unwrap: does not loop forever on a self-referencing envelope', () => {
    const weird = { viewOnceMessage: {} };
    assert.doesNotThrow(() => unwrap(weird));
});

test('extractText: body, extended text and captions', () => {
    assert.equal(extractText(text), 'hello there');
    assert.equal(extractText(link), 'look https://example.com/a');
    assert.equal(extractText(image), 'quiz please');
    assert.equal(extractText(sticker), '');
});

test('isVisual: images and documents only', () => {
    assert.equal(isVisual(image), true);
    assert.equal(isVisual(doc), true);
    assert.equal(isVisual(sticker), false);
    assert.equal(isVisual(video), false);
});

test('containsTrigger: whole-word match, case insensitive', () => {
    assert.equal(containsTrigger('quiz', 'quiz'), true);
    assert.equal(containsTrigger('QUIZ please', 'quiz'), true);
    assert.equal(containsTrigger('solve this quiz!', 'quiz'), true);
    assert.equal(containsTrigger('pls quiz 🙏', 'quiz'), true);
    assert.equal(containsTrigger('this is quizzical', 'quiz'), false);
    assert.equal(containsTrigger('quizmaster', 'quiz'), false);
    assert.equal(containsTrigger('', 'quiz'), false);
    assert.equal(containsTrigger('no trigger here', 'quiz'), false);
});

test('containsTrigger: custom trigger words with regex characters are safe', () => {
    assert.equal(containsTrigger('hey .solve now', '.solve'), true);
    assert.equal(containsTrigger('hey xsolve now', '.solve'), false);
});

test('getQuoted: exposes enough to download the quoted media', () => {
    const msg = {
        extendedTextMessage: {
            text       : 'quiz',
            contextInfo: { stanzaId: 'ABC123', participant: '923001234567@s.whatsapp.net', quotedMessage: image }
        }
    };
    const q = getQuoted(msg);
    assert.equal(q.id, 'ABC123');
    assert.equal(q.participant, '923001234567@s.whatsapp.net');
    assert.equal(classifyKind(q.message), 'image');
});

test('getQuoted: null when nothing is quoted', () => {
    assert.equal(getQuoted(text), null);
});

test('bareJid: strips the multi-device suffix', () => {
    assert.equal(bareJid('923001234567:12@s.whatsapp.net'), '923001234567@s.whatsapp.net');
    assert.equal(bareJid('1234-567@g.us'), '1234-567@g.us');
    assert.equal(bareJid(''), '');
});

test('isGroupJid', () => {
    assert.equal(isGroupJid('1234-567@g.us'), true);
    assert.equal(isGroupJid('923001234567@s.whatsapp.net'), false);
});
