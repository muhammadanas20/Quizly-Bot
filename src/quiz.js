/**
 * src/quiz.js — the quiz pipeline.
 *
 * trigger → download image → AI → per-question answer → send (chunked)
 *
 * Everything that touches the network is injected (download, solveQuiz, fetch)
 * so the whole pipeline can be exercised in tests with fakes.
 */

import { classifyKind, containsTrigger, extractText, getQuoted, isVisual } from './message.js';
import { parseQuizResult, renderQuiz, chunkText } from './format.js';
import { solveQuiz } from './ai/solve.js';

/** Lazily loaded; only used when the image is big enough to be worth resizing. */
let sharp = null;
let sharpChecked = false;
async function getSharp() {
    if (sharpChecked) return sharp;
    sharpChecked = true;
    try {
        sharp = (await import('sharp')).default;
    } catch {
        sharp = null;   // optional dependency — perfectly fine to be missing
    }
    return sharp;
}

const RESIZE_ABOVE_BYTES = 500 * 1024;
const RESIZE_MAX_EDGE = 1600;

export function createQuizHandler({ sock, config, log, limiter, inflight, download }) {
    /** Does this message ask for a quiz solve? */
    function trigger(msg, isGroup) {
        if (!isGroup && !config.allowPrivate) return false;
        const text = extractText(msg.message);
        if (!containsTrigger(text, config.quizTrigger)) return false;

        if (isVisual(msg.message)) return true;
        const quoted = getQuoted(msg.message);
        return Boolean(quoted && isVisual(quoted.message));
    }

    /** Pull the image out of the message (or the message it replies to). */
    async function grabImage(msg) {
        if (isVisual(msg.message)) {
            return await download(msg);
        }
        const quoted = getQuoted(msg.message);
        if (!quoted) return null;
        return await download({
            key: {
                remoteJid : msg.key.remoteJid,
                id        : quoted.id,
                fromMe    : false,
                participant: quoted.participant
            },
            message: quoted.message
        });
    }

    /** Downscale big screenshots — smaller upload = faster API answer. */
    async function shrink(buffer, mimeType) {
        if (!buffer || buffer.length < RESIZE_ABOVE_BYTES) return { buffer, mimeType };
        const lib = await getSharp();
        if (!lib) return { buffer, mimeType };
        try {
            const out = await lib(buffer)
                .rotate()                                   // honour EXIF orientation
                .resize({ width: RESIZE_MAX_EDGE, height: RESIZE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 82 })
                .toBuffer();
            if (out.length < buffer.length) {
                log.debug(`quiz: image shrunk ${(buffer.length / 1024) | 0}KB → ${(out.length / 1024) | 0}KB`);
                return { buffer: out, mimeType: 'image/jpeg' };
            }
        } catch (err) {
            log.debug(`quiz: resize skipped (${err.message})`);
        }
        return { buffer, mimeType };
    }

    function mimeOf(msg) {
        const m = msg?.message || {};
        const kind = classifyKind(m);
        if (kind === 'document') {
            const mt = m.documentMessage?.mimetype || '';
            return mt.startsWith('image/') ? mt : 'image/png';
        }
        return m.imageMessage?.mimetype || 'image/jpeg';
    }

    async function react(msg, emoji) {
        if (config.ackMode !== 'react') return;
        try {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
        } catch { /* a failed reaction must never break a solve */ }
    }

    async function sendChunks(jid, text, quoteKey) {
        const chunks = chunkText(text);
        for (let i = 0; i < chunks.length; i++) {
            await sock.sendMessage(jid, { text: chunks[i], ...(i === 0 && quoteKey ? { quoted: quoteKey } : {}) });
        }
        return chunks.length;
    }

    /**
     * Run one solve. Sends its own messages; returns a small status object.
     */
    async function solve(msg, { isGroup = true, chatName = '' } = {}) {
        const jid = msg.key.remoteJid;

        // ── one solve per chat at a time ────────────────────────────────────
        if (!inflight.begin(jid)) {
            return { ok: false, busy: true, error: null };
        }

        try {
            const gate = limiter.check();
            if (!gate.allowed) {
                await sock.sendMessage(jid, { text: `⏳ ${gate.reason}` });
                return { ok: false, error: gate.reason };
            }

            await react(msg, '👀');

            // ── image ───────────────────────────────────────────────────────
            let raw;
            try {
                raw = await grabImage(msg);
            } catch (err) {
                await sock.sendMessage(jid, { text: '❌ Could not download that image. Send it again as a photo or screenshot.' });
                log.warn(`quiz: download failed in "${chatName}": ${err.message}`);
                await react(msg, '❌');
                return { ok: false, error: err.message };
            }

            if (!raw || !raw.length) {
                await sock.sendMessage(jid, { text: '❌ No readable image found. Attach a screenshot of the quiz, or reply to one with the trigger word.' });
                await react(msg, '❌');
                return { ok: false, error: 'no image' };
            }

            const { buffer, mimeType } = await shrink(raw, mimeOf(msg));
            const image = { mimeType, data: buffer.toString('base64') };

            log.info(`quiz: solving for "${chatName}" · ${((buffer.length / 1024) | 0)}KB ${mimeType}`);

            // ── AI ──────────────────────────────────────────────────────────
            const result = await solveQuiz({ image, config, log, fetchImpl: config.fetchImpl });

            if (!result.ok) {
                await sock.sendMessage(jid, {
                    text:
                        `❌ *Could not solve that quiz.*\n${result.summary}\n\n` +
                        '💡 A crisp, uncropped screenshot works best.'
                });
                await react(msg, '❌');
                return { ok: false, error: result.summary };
            }

            limiter.record();

            // ── render ──────────────────────────────────────────────────────
            const parsed = parseQuizResult(result.text);
            const rendered = renderQuiz({
                ...parsed,
                provider : result.provider,
                model    : result.model,
                ms       : result.ms,
                truncated: result.truncated
            });

            if (!rendered) {
                // The model read the image but found nothing answerable — say so
                // in words instead of posting the empty JSON back at the group.
                if (parsed.questions.length === 0 && parsed.unreadable.length) {
                    await sock.sendMessage(jid, {
                        text:
                            `🤔 *Could not read any question in that image.*\n${parsed.unreadable.join(' · ')}\n\n` +
                            '💡 A sharper, uncropped screenshot works best.'
                    });
                    await react(msg, '❌');
                    log.warn(`quiz: no readable question in "${chatName}" via ${result.provider}`);
                    return { ok: false, provider: result.provider, questions: 0, error: 'no readable question' };
                }

                // The model answered but not in a usable shape — never drop it.
                const fallback = `*Quiz solved* (${result.provider})\n\n${result.text}`.slice(0, 3800);
                await sendChunks(jid, fallback, msg.key);
                await react(msg, '✅');
                log.warn(`quiz: unparsed model output in "${chatName}" — sent raw text`);
                return { ok: true, provider: result.provider, questions: 0, unparsed: true };
            }

            if (result.truncated) {
                log.warn(`quiz: ${result.provider} hit its output limit in "${chatName}" — later questions may be missing`);
            } else if (parsed.repaired) {
                log.debug(`quiz: repaired malformed JSON from ${result.provider} in "${chatName}"`);
            }

            const parts = await sendChunks(jid, rendered, msg.key);
            await react(msg, '✅');

            log.info(`quiz: answered ${parsed.questions.length} question(s) for "${chatName}" via ${result.provider}/${result.model} in ${result.ms}ms (${parts} msg)`);
            return { ok: true, provider: result.provider, model: result.model, questions: parsed.questions.length, ms: result.ms };
        } finally {
            inflight.end(jid);
        }
    }

    return { trigger, solve, grabImage, shrink, sendChunks };
}

export default createQuizHandler;
