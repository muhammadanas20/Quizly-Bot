/**
 * src/ai/solve.js — provider chain.
 *
 * Tries each configured provider in AI_ORDER. Inside a provider it walks the
 * model list (primary + fallbacks) so a retired model id does not take the bot
 * down — it just moves to the next one.
 *
 *   kind 'model' (404)  → next model, same provider
 *   anything else       → next provider
 */

import { callGemini } from './gemini.js';
import { callOpenAICompat } from './openaiCompat.js';
import { QUIZ_PROMPT } from './prompt.js';

function extrasFor(provider, cfg) {
    // Grok 4.x are reasoning models: 'low' keeps latency (and cost) down.
    if (provider === 'grok' && cfg.reasoningEffort) return { reasoning_effort: cfg.reasoningEffort };
    return {};
}

export const solveQuiz = ({ image, config, log, fetchImpl }) =>
    runAI({ image, prompt: QUIZ_PROMPT, config, log, fetchImpl });

/** Also used for the once-a-day, text-only trivia + scramble refresh. */
export async function runAI({ image, prompt, config, log, fetchImpl, signal, maxTokens = config.aiMaxTokens, responseSchema, validate }) {
    const attempts = [];
    let triedAny = false;

    for (const provider of config.aiOrder) {
        if (signal?.aborted) return { ok: false, attempts, summary: 'AI request cancelled.' };
        const cfg = config[provider];
        if (!cfg?.key) continue;

        const models = [cfg.model, ...(cfg.fallbacks || [])].filter(Boolean);

        for (const model of models) {
            if (signal?.aborted) return { ok: false, attempts, summary: 'AI request cancelled.' };
            triedAny = true;
            const started = Date.now();
            try {
                const out = provider === 'gemini'
                    ? await callGemini({
                        apiKey         : cfg.key,
                        model,
                        image,
                        prompt,
                        timeoutMs      : config.aiTimeoutMs,
                        maxTokens,
                        thinkingBudget : cfg.thinkingBudget,
                        responseSchema,
                        fetchImpl,
                        signal
                    })
                    : await callOpenAICompat({
                        name      : provider,
                        apiKey    : cfg.key,
                        model,
                        image,
                        prompt,
                        timeoutMs : config.aiTimeoutMs,
                        maxTokens,
                        extras    : extrasFor(provider, cfg),
                        fetchImpl,
                        signal
                    });

                if (signal?.aborted) return { ok: false, attempts, summary: 'AI request cancelled.' };
                // Invalid/incomplete daily content must fall through to the next
                // configured provider, not overwrite yesterday's valid pool.
                const data = validate ? await validate(out) : undefined;
                return { ok: true, ...out, ...(validate ? { data } : {}), ms: Date.now() - started, attempts };
            } catch (err) {
                if (signal?.aborted) return { ok: false, attempts, summary: 'AI request cancelled.' };
                const attempt = {
                    provider,
                    model,
                    kind  : err.kind || 'unknown',
                    status: err.status || 0,
                    error : err.message
                };
                attempts.push(attempt);
                log?.warn?.(`ai: ${provider}/${model} failed [${attempt.kind}] ${err.message}`);

                if (attempt.kind === 'model' || attempt.kind === 'bad_response') continue;
                break; // other failures → next provider (including quota/auth/timeouts)
            }
        }
    }

    if (!triedAny) {
        return {
            ok      : false,
            attempts,
            summary : 'No AI provider is configured. Add GROQ_API_KEY, GEMINI_API_KEY or XAI_API_KEY to the .env file.'
        };
    }

    return { ok: false, attempts, summary: summarise(attempts, { hasImage: Boolean(image) }) };
}

/** Turn a list of failures into one line a human can act on. */
export function summarise(attempts, { hasImage = true } = {}) {
    if (!attempts.length) return 'No AI provider is configured.';
    const last = attempts[attempts.length - 1];
    const kinds = new Set(attempts.map((a) => a.kind));

    if (kinds.has('auth'))    return 'API key rejected. Check GROQ_API_KEY / GEMINI_API_KEY / XAI_API_KEY in .env.';
    if (kinds.has('rate'))    return 'AI rate limit hit on every provider. Try again later.';
    if (kinds.has('timeout')) return hasImage
        ? 'The AI timed out. The image may be very large — send a smaller screenshot.'
        : 'The AI timed out while preparing game content. The bot will retry later.';
    if (kinds.has('network')) return 'The VM could not reach the AI servers. Check outbound internet / DNS.';
    if (kinds.has('model'))   return 'Every configured model id was rejected. Run `npm run check` to list valid ones.';

    return last.error.length > 160 ? `${last.error.slice(0, 160)}…` : last.error;
}

export default solveQuiz;
