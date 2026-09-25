/**
 * src/ai/openaiCompat.js — one client for every OpenAI-compatible provider.
 *
 * Used for xAI Grok (https://api.x.ai/v1) and Groq (https://api.groq.com/openai/v1).
 * Both speak the same chat/completions dialect, including base64 data-URL
 * images, so a single implementation covers them.
 */

import { AiError, classifyStatus, readErrorBody, postJsonWithFallbacks } from './http.js';

const PROVIDERS = {
    grok: { baseUrl: 'https://api.x.ai/v1' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1' }
};

export function buildChatBody({ model, image, prompt, maxTokens, extras = {} }) {
    return {
        model,
        messages: [{
            role   : 'user',
            content: image
                ? [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
                ]
                : prompt
        }],
        temperature    : 0.1,
        max_tokens     : maxTokens,
        stream         : false,
        response_format: { type: 'json_object' },
        ...extras
    };
}

export async function callOpenAICompat({
    name, apiKey, model, image, prompt, timeoutMs, maxTokens, extras = {}, fetchImpl, signal
}) {
    const baseUrl = PROVIDERS[name]?.baseUrl;
    if (!baseUrl) throw new AiError(`unknown provider "${name}"`, { provider: name, model, kind: 'unknown' });

    const res = await postJsonWithFallbacks(`${baseUrl}/chat/completions`, {
        headers    : { authorization: `Bearer ${apiKey}` },
        body       : buildChatBody({ model, image, prompt, maxTokens, extras }),
        // providers disagree on which optional fields they accept; drop the
        // least essential one and retry rather than failing the whole quiz
        dropFields : ['reasoning_effort', 'response_format'],
        timeoutMs,
        fetchImpl,
        signal
    });

    if (res.status >= 400) {
        const { kind, retryable } = classifyStatus(res.status);
        throw new AiError(`${readErrorBody(res.json, res.text)}`, {
            status: res.status, provider: name, model, retryable, kind
        });
    }

    const choice = res.json?.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) {
        throw new AiError(`empty response (finish_reason=${choice?.finish_reason || 'none'})`, {
            status: 200, provider: name, model, kind: 'unknown', retryable: true
        });
    }

    // 'length' = the answer was cut off by max_tokens, so the JSON is probably
    // incomplete. Salvage what is there and warn about the rest.
    return {
        provider: name, model, text,
        finishReason: choice?.finish_reason || '',
        truncated: choice?.finish_reason === 'length',
        usage: res.json?.usage || null
    };
}

export default callOpenAICompat;
