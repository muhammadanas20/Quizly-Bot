/**
 * src/ai/http.js — one small POST helper shared by every provider.
 *
 * Raw fetch instead of an SDK: the groq/openai/google SDKs pull in dozens of
 * packages and tens of megabytes of heap that a 1 GiB VM does not have.
 * Node's built-in fetch (undici) already keeps connections alive, so repeated
 * calls reuse the same TLS session — that alone saves 200-400 ms per quiz.
 */

export class AiError extends Error {
    constructor(message, { status = 0, provider = '', model = '', retryable = false, kind = 'unknown' } = {}) {
        super(message);
        this.name      = 'AiError';
        this.status    = status;
        this.provider  = provider;
        this.model     = model;
        this.retryable = retryable;
        this.kind      = kind; // 'auth' | 'rate' | 'model' | 'bad_request' | 'server' | 'network' | 'timeout' | 'unknown'
    }
}

/** Classify an HTTP status into something the fallback logic can act on. */
export function classifyStatus(status) {
    if (status === 401 || status === 403) return { kind: 'auth',        retryable: false };
    if (status === 404)                   return { kind: 'model',       retryable: false };
    if (status === 429)                   return { kind: 'rate',        retryable: true  };
    if (status === 400 || status === 422) return { kind: 'bad_request', retryable: false };
    if (status >= 500)                    return { kind: 'server',      retryable: true  };
    return { kind: 'unknown', retryable: status >= 400 ? false : true };
}

/** Read an error message out of whichever error body shape the provider used. */
export function readErrorBody(json, fallbackText) {
    return (
        json?.error?.message ||
        json?.error?.msg ||
        (Array.isArray(json?.error) ? json.error[0]?.message : null) ||
        json?.message ||
        fallbackText ||
        'unknown error'
    );
}

/**
 * POST JSON with a hard timeout.
 * @returns {Promise<{status:number, json:any, text:string}>}
 */
export async function postJson(url, { headers, body, timeoutMs = 60000, fetchImpl } = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    if (typeof doFetch !== 'function') {
        throw new AiError('global fetch is unavailable — Node 18+ is required', { kind: 'network' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await doFetch(url, {
            method : 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body   : JSON.stringify(body),
            signal : controller.signal
        });

        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
        return { status: res.status, json, text };
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new AiError(`timed out after ${timeoutMs}ms`, { kind: 'timeout', retryable: true });
        }
        throw new AiError(err?.message || 'network error', { kind: 'network', retryable: true });
    } finally {
        clearTimeout(timer);
    }
}

/** True when `path` ("a.b.c") resolves to something present in `obj`. */
export function hasPath(obj, path) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur === null || typeof cur !== 'object' || !(seg in cur)) return false;
        cur = cur[seg];
    }
    return cur !== undefined;
}

/** Copy `obj` without the leaf named by `path` ("a.b.c"). */
export function withoutPath(obj, path) {
    const segs = path.split('.');
    const clone = (node, depth) => {
        const out = Array.isArray(node) ? [...node] : { ...node };
        if (depth === segs.length - 1) delete out[segs[depth]];
        else if (out[segs[depth]] && typeof out[segs[depth]] === 'object') {
            out[segs[depth]] = clone(out[segs[depth]], depth + 1);
        }
        return out;
    };
    return clone(obj, 0);
}

/**
 * POST, then retry with optional body fields removed if the provider rejects
 * the request with 400. Provider APIs drift (a field that was fine last month
 * starts 400-ing); dropping the extras keeps the bot alive instead of failing
 * every quiz. `dropFields` entries may be dotted paths such as
 * "generationConfig.thinkingConfig".
 * Returns the successful { status, json, text } or the last failing response.
 */
export async function postJsonWithFallbacks(url, { headers, body, dropFields = [], timeoutMs, fetchImpl, maxRetries = dropFields.length }) {
    let current = body;
    let last = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await postJson(url, { headers, body: current, timeoutMs, fetchImpl });
        if (res.status < 400) return res;

        last = res;
        const field = dropFields[attempt];
        const canDrop = attempt < maxRetries && field && hasPath(current, field);
        if (res.status !== 400 || !canDrop) return res;

        current = withoutPath(current, field);
    }
    return last;
}
