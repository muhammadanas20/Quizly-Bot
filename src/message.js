/**
 * src/message.js — pure helpers for reading a Baileys WAMessage.
 *
 * No socket, no I/O: every function here takes a plain object and returns a
 * plain value, which is what makes the guard and the quiz trigger testable.
 */

/** Message types WhatsApp wraps in an envelope before the real payload. */
const WRAPPERS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage'
];

/** Peel envelopes so `imageMessage` etc. can be found wherever WhatsApp hides it. */
export function unwrap(message) {
    let cur = message;
    for (let depth = 0; cur && depth < 6; depth++) {
        const key = WRAPPERS.find((w) => cur[w]);
        if (!key) return cur;
        cur = cur[key]?.message ?? cur[key];
    }
    return cur || {};
}

/** Human-readable text of a message (body or caption), or '' if it has none. */
export function extractText(message) {
    const m = unwrap(message);
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.listResponseMessage?.title ||
        ''
    );
}

/**
 * Coarse media kind of a message. This is what the sticker guard matches on.
 * @returns {'sticker'|'image'|'video'|'gif'|'audio'|'document'|'link'|'text'|
 *          'location'|'contact'|'poll'|'reaction'|'system'|'unknown'}
 */
export function classifyKind(message) {
    if (!message) return 'unknown';
    const m = unwrap(message);

    if (m.stickerMessage)   return 'sticker';
    if (m.imageMessage)     return 'image';
    if (m.videoMessage)     return m.videoMessage.gifPlayback ? 'gif' : 'video';
    if (m.audioMessage)     return 'audio';
    if (m.documentMessage)  return 'document';
    if (m.locationMessage)  return 'location';
    if (m.contactMessage || m.contactsArrayMessage) return 'contact';
    if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) return 'poll';
    if (m.reactionMessage)  return 'reaction';
    if (m.protocolMessage || m.senderKeyDistributionMessage) return 'system';

    const text = extractText(message);
    if (text) return /https?:\/\/\S+/i.test(text) ? 'link' : 'text';
    return 'unknown';
}

/** True when the message carries something the AI can actually look at. */
export function isVisual(message) {
    const kind = classifyKind(message);
    return kind === 'image' || kind === 'document';
}

/**
 * Does the text ask for a quiz? Matches the trigger as a whole word so that
 * "quiz", "QUIZ", "quiz!" and "pls quiz" fire, but "quizzical" does not.
 */
export function containsTrigger(text, trigger) {
    const t = String(text || '').toLowerCase();
    const k = String(trigger || 'quiz').toLowerCase();
    if (!t || !k) return false;
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(t);
}

/**
 * If this message quotes another one, return enough to download that media.
 * Lets people reply "quiz" to a screenshot they sent earlier.
 */
export function getQuoted(message) {
    const m = unwrap(message);
    const ctx = m.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    return {
        id         : ctx.stanzaId,
        participant: ctx.participant,
        message    : ctx.quotedMessage
    };
}

/** Group sender: participant for groups, remoteJid for 1-on-1 chats. */
export function senderOf(msg) {
    return msg?.key?.participant || msg?.key?.remoteJid || '';
}

/** Strip the ":device" suffix Baileys adds to multi-device JIDs. */
export function bareJid(jid) {
    const s = String(jid || '');
    const at = s.lastIndexOf('@');
    if (at < 0) return s.split(':')[0];
    return `${s.slice(0, at).split(':')[0]}@${s.slice(at + 1)}`;
}

/** "1234-567890@g.us" → true */
export function isGroupJid(jid) {
    return String(jid || '').endsWith('@g.us');
}
