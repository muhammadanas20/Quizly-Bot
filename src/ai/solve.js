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

export async function solveQuiz({ image, config, log, fetchImpl }) {
    const attempts = [];
    let triedAny = false;

    for (const provider of config.aiOrder) {
        const cfg = config[provider];
        if (!cfg?.key) continue;

        const models = [cfg.model, ...(cfg.fallbacks || [])].filter(Boolean);

        for (const model of models) {
            triedAny = true;
            const started = Date.now();
            try {
                const out = provider === 'gemini'
                    ? await callGemini({
                        apiKey         : cfg.key,
                        model,
                        image,
                        prompt         : QUIZ_PROMPT,
                        timeoutMs      : config.aiTimeoutMs,
                        maxTokens      : config.aiMaxTokens,
                        thinkingBudget : cfg.thinkingBudget,
                        fetchImpl
                    })
                    : await callOpenAICompat({
                        name      : provider,
                        apiKey    : cfg.key,
                        model,
                        image,
                        prompt    : QUIZ_PROMPT,
                        timeoutMs : config.aiTimeoutMs,
                        maxTokens : config.aiMaxTokens,
                        extras    : extrasFor(provider, cfg),
                        fetchImpl
                    });

                return { ok: true, ...out, ms: Date.now() - started, attempts };
            } catch (err) {
                const attempt = {
                    provider,
                    model,
                    kind  : err.kind || 'unknown',
                    status: err.status || 0,
                    error : err.message
                };
                attempts.push(attempt);
                log?.warn?.(`ai: ${provider}/${model} failed [${attempt.kind}] ${err.message}`);

                if (attempt.kind === 'model') continue;   // retired/unknown model → next in list
                break;                                    // otherwise → next provider
            }
        }
    }

    if (!triedAny) {
        return {
            ok      : false,
            attempts,
            summary : 'No AI provider is configured. Add GEMINI_API_KEY or XAI_API_KEY to the .env file.'
        };
    }

    return { ok: false, attempts, summary: summarise(attempts) };
}

/** Turn a list of failures into one line a human can act on. */
export function summarise(attempts) {
    if (!attempts.length) return 'No AI provider is configured.';
    const last = attempts[attempts.length - 1];
    const kinds = new Set(attempts.map((a) => a.kind));

    if (kinds.has('auth'))    return 'API key rejected. Check GEMINI_API_KEY / XAI_API_KEY in .env.';
    if (kinds.has('rate'))    return 'AI rate limit hit on every provider. Try again in a minute.';
    if (kinds.has('timeout')) return 'The AI timed out. The image may be very large — send a smaller screenshot.';
    if (kinds.has('network')) return 'The VM could not reach the AI servers. Check outbound internet / DNS.';
    if (kinds.has('model'))   return 'Every configured model id was rejected. Run `npm run check` to list valid ones.';

    return last.error.length > 160 ? `${last.error.slice(0, 160)}…` : last.error;
}

export default solveQuiz;
