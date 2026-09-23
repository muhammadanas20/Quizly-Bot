/**
 * src/ai/gemini.js — Google Gemini (generateContent REST).
 *
 * Called with plain fetch so there is no SDK in the dependency tree.
 * Speed knobs that matter on a 1 GiB VM / free tier:
 *   • thinkingBudget 0 on 2.5-* models  → no reasoning tokens, ~2-4x faster
 *   • responseMimeType application/json → the shape comes back parseable first try
 */

import { AiError, classifyStatus, readErrorBody, postJsonWithFallbacks } from './http.js';
import { GEMINI_RESPONSE_SCHEMA } from './prompt.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function buildGeminiBody({ model, image, prompt, maxTokens, thinkingBudget }) {
    const generationConfig = {
        temperature       : 0.1,
        maxOutputTokens   : maxTokens,
        responseMimeType  : 'application/json',
        responseSchema    : GEMINI_RESPONSE_SCHEMA
    };

    // thinkingConfig is only valid on the 2.5 generation; sending it to other
    // models makes the API reject the request, so gate it on the model name.
    if (thinkingBudget !== null && thinkingBudget !== undefined && /(^|[^0-9])2\.5/.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: Number(thinkingBudget) };
    }

    return {
        contents: [{
            role : 'user',
            parts: [
                { inline_data: { mime_type: image.mimeType, data: image.data } },
                { text: prompt }
            ]
        }],
        generationConfig
    };
}

export async function callGemini({ apiKey, model, image, prompt, timeoutMs, maxTokens, thinkingBudget = 0, fetchImpl }) {
    const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;

    const res = await postJsonWithFallbacks(url, {
        headers    : { 'x-goog-api-key': apiKey },
        body       : buildGeminiBody({ model, image, prompt, maxTokens, thinkingBudget }),
        // newest / least-supported knobs get dropped first if the API 400s
        dropFields : ['generationConfig.thinkingConfig', 'generationConfig.responseSchema'],
        timeoutMs,
        fetchImpl
    });

    if (res.status >= 400) {
        const { kind, retryable } = classifyStatus(res.status);
        throw new AiError(`${readErrorBody(res.json, res.text)}`, {
            status: res.status, provider: 'gemini', model, retryable, kind
        });
    }

    const blocked = res.json?.promptFeedback?.blockReason;
    if (blocked) {
        throw new AiError(`image blocked by safety filters (${blocked})`, {
            status: 200, provider: 'gemini', model, kind: 'bad_request'
        });
    }

    const candidate = res.json?.candidates?.[0];
    const finishReason = candidate?.finishReason || '';

    if (candidate?.finishReason === 'SAFETY') {
        throw new AiError('image blocked by safety filters', {
            status: 200, provider: 'gemini', model, kind: 'bad_request'
        });
    }

    const text = (candidate?.content?.parts || [])
        .map((p) => p?.text || '')
        .join('')
        .trim();

    if (!text) {
        throw new AiError(`empty response (finishReason=${finishReason || 'none'})`, {
            status: 200, provider: 'gemini', model, kind: 'unknown', retryable: true
        });
    }

    // MAX_TOKENS means the JSON was cut in half — the parser salvages what it
    // can, but the caller should warn that later questions may be missing.
    return {
        provider: 'gemini', model, text, finishReason,
        truncated: finishReason === 'MAX_TOKENS',
        usage: res.json?.usageMetadata || null
    };
}

export default callGemini;
