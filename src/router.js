/**
 * src/router.js — decides what to do with one incoming message.
 *
 * Order matters:
 *   1. media guard    — must run first and must be cheap; this is the feature
 *                       that has to feel instant
 *   2. commands       — owner control surface + the game commands
 *   3. game rounds    — a plain "57" or "heads" is a guess while one is running
 *   4. quiz trigger   — the expensive path, only reached when asked for
 *
 * Kept separate from bot.js so the routing can be driven in tests with a fake
 * socket instead of a live WhatsApp connection.
 */

import { collectSenderIds } from './guard.js';
import { parseCommand } from './commands.js';
import { extractText, senderOf, bareJid, isGroupJid, identitiesOf } from './message.js';

/** Chats the bot should never respond in. */
const IGNORED_SUFFIXES = ['@broadcast', '@newsletter'];
const IGNORED_JIDS = new Set(['status@broadcast']);

export function shouldIgnore(jid) {
    const j = String(jid || '');
    if (!j || IGNORED_JIDS.has(j)) return true;
    return IGNORED_SUFFIXES.some((s) => j.endsWith(s));
}

export function createRouter({ sock, config, log, flags, guard, groups, quiz, commands, games }) {
    async function processMessage(msg) {
        const jid = msg?.key?.remoteJid;
        if (shouldIgnore(jid)) return { ignored: true };

        const isGroup = isGroupJid(jid);
        const fromMe  = Boolean(msg?.key?.fromMe);

        // 1. guard — silent, instant, and the cheapest possible check first.
        // Once media has been revoked, do not hand it to the quiz solver or
        // process a caption/command attached to the deleted message.
        try {
            const verdict = await guard.handle(msg);
            // Don't process media that should have been removed when the bot
            // lacks admin rights; it would otherwise reach the quiz solver.
            if (verdict?.act === 'delete' || verdict?.reason === 'bot-not-admin') {
                return { guarded: true };
            }
        } catch (err) {
            log.warn(`guard error: ${err.message}`);
            // Fail closed: a guard failure on a flagged sender must not forward
            // that message's media to the quiz solver or another command path.
            return { guarded: true, guardError: true };
        }

        const text = extractText(msg.message);
        const senderIds = collectSenderIds(msg, sock);

        // A command typed from the bot's own account is an owner command: that
        // account only lives on hardware the operator controls, and driving the
        // bot from the phone it runs on is the natural thing to do. Without
        // this, `!flag` typed on the bot's own phone is silently dropped — the
        // bot appears to ignore the command entirely.
        const isOwner = fromMe || [...senderIds].some((id) => config.owners.includes(id));

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
            quotedParticipant: msg.message?.extendedTextMessage?.contextInfo?.participant,
            groups,
            // one JID → every identity that same human can be known by, so
            // !flag and !unflag always agree on who they are talking about
            expandIds        : (raw) => identitiesOf(raw, sock)
        };

        /**
         * The reaction is the confirmation: it lands on the command message
         * itself, so the group sees "done" without the bot having to say
         * anything. Shared by commands and game replies.
         */
        async function deliver(out) {
            if (out?.react) {
                try {
                    await sock.sendMessage(jid, { react: { text: out.react, key: msg.key } });
                } catch (err) {
                    log.debug(`react failed: ${err.message}`);
                }
            }
            if (out?.handled && out?.reply) await sock.sendMessage(jid, { text: out.reply });
        }

        // 2. commands
        if (text.trim().startsWith('!')) {
            const parsed = parseCommand(text);
            if (!parsed) return { unknownCommand: true };
            try {
                const out = await commands.handle(ctx);
                await deliver(out);
                return { command: parsed.name };
            } catch (err) {
                log.error(`command "${parsed.name}" failed: ${err.message}`);
                try {
                    await sock.sendMessage(jid, { text: `⚠️ That command failed: ${err.message}` });
                } catch { /* the chat may be gone; nothing useful to do */ }
                return { command: parsed.name, error: err.message };
            }
        }

        // The quiz trigger wins over a game round: a screenshot captioned
        // "quiz" while a number game is running is still a quiz solve.
        const wantsQuiz = !fromMe && quiz.trigger(msg, isGroup);

        // 3. games — while a round is running, a bare "57" or "heads" is a
        // guess. Uses the same deliver() so a guess confirms with a reaction.
        if (!fromMe && !wantsQuiz) {
            // A game that throws must never swallow a message that the quiz
            // solver could still answer, so failures fall through.
            try {
                const out = await games?.handleMessage?.(ctx);
                if (out?.handled) {
                    await deliver(out);
                    return { game: true };
                }
            } catch (err) {
                log.warn(`game error: ${err.message}`);
            }
        }

        // 4. quiz — never on our own messages. The bot's answer quotes the quiz
        // image, so re-processing it would solve the same quiz forever.
        if (fromMe) return { own: true };
        if (!wantsQuiz) return { nothing: true };

        log.info(`quiz triggered in "${ctx.chatName}" by ${ctx.senderLabel}`);
        const res = await quiz.solve(msg, { isGroup, chatName: ctx.chatName });
        if (res?.busy) log.debug('quiz: already solving in this chat — ignoring duplicate trigger');
        return { quiz: res };
    }

    return { processMessage, shouldIgnore };
}

export default createRouter;
