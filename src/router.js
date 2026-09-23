/**
 * src/router.js — decides what to do with one incoming message.
 *
 * Order matters:
 *   1. sticker guard  — must run first and must be cheap; this is the feature
 *                       that has to feel instant
 *   2. commands       — owner control surface
 *   3. quiz trigger   — the expensive path, only reached when asked for
 *
 * Kept separate from bot.js so the routing can be driven in tests with a fake
 * socket instead of a live WhatsApp connection.
 */

import { collectSenderIds } from './guard.js';
import { parseCommand } from './commands.js';
import { extractText, senderOf, bareJid, isGroupJid } from './message.js';

/** Chats the bot should never respond in. */
const IGNORED_SUFFIXES = ['@broadcast', '@newsletter'];
const IGNORED_JIDS = new Set(['status@broadcast']);

export function shouldIgnore(jid) {
    const j = String(jid || '');
    if (!j || IGNORED_JIDS.has(j)) return true;
    return IGNORED_SUFFIXES.some((s) => j.endsWith(s));
}

export function createRouter({ sock, config, log, flags, guard, groups, quiz, commands }) {
    async function processMessage(msg) {
        const jid = msg?.key?.remoteJid;
        if (shouldIgnore(jid)) return { ignored: true };

        const isGroup = isGroupJid(jid);

        // 1. guard — silent, instant, and the cheapest possible check first
        try {
            await guard.handle(msg);
        } catch (err) {
            log.warn(`guard error: ${err.message}`);
        }

        if (msg.key.fromMe) return { own: true };

        const text = extractText(msg.message);
        const senderIds = collectSenderIds(msg, sock);
        const isOwner = [...senderIds].some((id) => config.owners.includes(id));

        const ctx = {
            sock,
            msg,
            jid,
            isGroup,
            text,
            senderIds,
            isOwner,
            senderLabel      : bareJid(senderOf(msg)),
            chatName         : groups.subjectOf(jid) || (isGroup ? jid : 'private'),
            mentioned        : msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
            quotedParticipant: msg.message?.extendedTextMessage?.contextInfo?.participant
        };

        // 2. commands
        if (text.trim().startsWith('!')) {
            const parsed = parseCommand(text);
            if (!parsed) return { unknownCommand: true };
            try {
                const out = await commands.handle(ctx);
                if (out.handled && out.reply) await sock.sendMessage(jid, { text: out.reply });
                return { command: parsed.name };
            } catch (err) {
                log.error(`command "${parsed.name}" failed: ${err.message}`);
                try {
                    await sock.sendMessage(jid, { text: `⚠️ That command failed: ${err.message}` });
                } catch { /* the chat may be gone; nothing useful to do */ }
                return { command: parsed.name, error: err.message };
            }
        }

        // 3. quiz
        if (!quiz.trigger(msg, isGroup)) return { nothing: true };

        log.info(`quiz triggered in "${ctx.chatName}" by ${ctx.senderLabel}`);
        const res = await quiz.solve(msg, { isGroup, chatName: ctx.chatName });
        if (res?.busy) log.debug('quiz: already solving in this chat — ignoring duplicate trigger');
        return { quiz: res };
    }

    return { processMessage, shouldIgnore };
}

export default createRouter;
