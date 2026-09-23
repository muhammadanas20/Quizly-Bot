/**
 * src/format.js — turn the model's JSON into the exact WhatsApp layout:
 *
 *     *Q1.* question text
 *     💡 one-line reason
 *     ✅ *answer*
 *
 * …repeated in order for every question, then a compact answer key at the end.
 *
 * Parsing is deliberately forgiving: models wrap JSON in ``` fences, add prose
 * around it, pretty-print values across lines, or run out of tokens half way
 * through the last question. We try progressively sloppier strategies — strict
 * JSON, then a repaired document, then raw key/value pairs, then numbered
 * prose — and, as a last resort, hand the raw text straight to the group so a
 * weird reply never costs the user their answers.
 */

const MAX_MESSAGE = 3800;   // WhatsApp's text limit is 4096; keep a margin

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isSpace = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';

// ─── Parsing ─────────────────────────────────────────────────────────────────
const QUESTION_ALIASES = ['question', 'q', 'text', 'prompt', 'problem'];
const REASON_ALIASES   = ['reason', 'why', 'explanation', 'rationale', 'reasoning', 'r'];
const ANSWER_ALIASES   = ['answer', 'a', 'correct', 'correct_answer', 'solution', 'ans'];

const pick = (obj, names) => {
    for (const n of names) {
        if (obj[n] !== undefined && obj[n] !== null && String(obj[n]).trim() !== '') return obj[n];
    }
    return '';
};

function coerceQuestions(rawList) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    rawList.forEach((item, i) => {
        if (!item || typeof item !== 'object') {
            // some models return a flat array of strings
            const s = oneLine(item);
            if (s) out.push({ n: i + 1, question: '', reason: '', answer: s });
            return;
        }
        const question = oneLine(pick(item, QUESTION_ALIASES));
        const reason   = oneLine(pick(item, REASON_ALIASES)).slice(0, 200);
        const answer   = oneLine(pick(item, ANSWER_ALIASES));
        if (!question && !answer) return;
        const n = Number(item.n ?? item.number ?? item.index ?? i + 1);
        out.push({ n: Number.isFinite(n) && n > 0 ? n : i + 1, question, reason, answer });
    });
    return out;
}

function stripFences(text) {
    return String(text || '')
        .replace(/^\s*```(?:json|javascript|js)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
}

/** Last-resort salvage: read "1. question … answer: X" style prose. */
function salvageFromProse(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const found = [];

    for (const line of lines) {
        // "1. …", "1) …", "**Q1.** …", "Q1: …"
        const m = line.match(/^\**\s*(?:q\s*)?(\d{1,2})\s*[.)\-:]\s*\**\s*(.*)$/i);
        if (!m) {
            // a lone "answer: X" line belongs to the question above it
            const a = line.match(/^(?:[-•*]\s*)?(?:answer|ans|correct)\s*[:\-–]\s*(.+)$/i);
            if (a && found.length && !found[found.length - 1].answer) {
                found[found.length - 1].answer = oneLine(a[1]);
            }
            continue;
        }
        const body = m[2];
        const inline = body.match(/(?:answer|ans|correct)\s*[:\-–]\s*(.+)$/i);
        found.push({
            n       : Number(m[1]),
            question: inline ? body.slice(0, inline.index).trim() : body,
            reason  : '',
            answer  : inline ? oneLine(inline[1]) : ''
        });
    }
    return found;
}

/**
 * Raw newlines/tabs inside a JSON string literal are illegal, yet models emit
 * them whenever they pretty-print a long value across lines. Escaping them
 * turns "the shape is fine, JSON.parse disagrees" into a successful parse.
 * Anything outside the strings is left untouched.
 */
export function escapeRawControlChars(src) {
    let out = '';
    let inStr = false;
    let esc = false;

    for (const ch of String(src ?? '')) {
        if (inStr) {
            if (esc) { out += ch; esc = false; continue; }
            if (ch === '\\') { out += ch; esc = true; continue; }
            if (ch === '"') { out += ch; inStr = false; continue; }
            out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : ch;
            continue;
        }
        if (ch === '"') inStr = true;
        out += ch;
    }
    return out;
}

/**
 * Repair a truncated or sloppy JSON document just enough for JSON.parse.
 *
 * Covers the failures that actually reach us from vision models:
 *   • output cut off mid-string by the token limit (finishReason MAX_TOKENS)
 *   • a dangling "key": with no value, or a trailing comma
 *   • unclosed objects / arrays
 *
 * @returns {string|null} a parseable document, or null when nothing is salvageable
 */
export function repairJson(src) {
    const s = escapeRawControlChars(String(src ?? ''));
    if (!s.includes('{') && !s.includes('[')) return null;

    const stack = [];          // open containers, innermost last: '}' or ']'
    let quote = '';            // quote char while inside a string
    let esc = false;
    let prev = '';             // last significant char outside a string
    let prevBeforeStr = '';    // what `prev` was when the current string opened
    let strStart = -1;
    let valueEnd = -1;         // index just past the last complete value
    let valueStack = [];
    let keyStart = -1;         // opening quote of the key currently being read
    let firstTopEnd = -1;      // end of the first complete top-level value

    for (let i = 0; i < s.length; i++) {
        const c = s[i];

        if (quote) {
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === quote) {
                quote = '';
                // "x" straight after ':' is a value; inside an array every
                // element is a value; anything else is a key, and cutting into
                // a key would leave a dangling `"key":` behind.
                const inArray = stack[stack.length - 1] === ']';
                if (prevBeforeStr === ':' || inArray) { valueEnd = i + 1; valueStack = stack.slice(); }
                else keyStart = strStart;
                prev = '"';
            }
            continue;
        }

        if (c === '"' || c === "'") { quote = c; strStart = i; prevBeforeStr = prev; prev = c; continue; }
        if (c === '{') { stack.push('}'); prev = '{'; continue; }
        if (c === '[') { stack.push(']'); prev = '['; continue; }

        if (c === '}' || c === ']') {
            if (stack.length) stack.pop();
            valueEnd = i + 1;
            valueStack = stack.slice();
            if (!stack.length && firstTopEnd < 0) firstTopEnd = i + 1;
            prev = c;
            continue;
        }

        if (c === ',' || c === ':') { prev = c; continue; }
        if (isSpace(c)) continue;

        // bare literal: number, true, false, null
        let j = i;
        while (j < s.length && /[0-9a-zA-Z._+-]/.test(s[j])) j++;
        if (j > i) { valueEnd = j; valueStack = stack.slice(); i = j - 1; prev = 'x'; }
    }

    // Where to cut, and what has to be appended to make the remainder legal.
    let end, tail, openStack;
    if (quote) {
        if (prevBeforeStr === ':') {
            end = s.length; tail = quote; openStack = stack.slice();   // close the half-written value
        } else {
            end = keyStart; tail = ''; openStack = stack.slice();      // drop the dangling key
        }
    } else {
        end = valueEnd; tail = ''; openStack = valueStack.slice();
    }

    const builds = [];
    if (firstTopEnd > 0) builds.push({ end: firstTopEnd, tail: '', openStack: [] });
    if (end > 0) builds.push({ end, tail, openStack });

    for (const b of builds) {
        let body = s.slice(0, b.end) + b.tail;
        body = body.replace(/([,{\[]\s*"(?:[^"\\]|\\.)*"\s*:\s*)+$/, '');   // dangling key(s)
        body = body.replace(/[,\s:]+$/, '');                              // trailing comma/colon
        if (!body) continue;
        const candidate = body + b.openStack.slice().reverse().join('');
        try { JSON.parse(candidate); return candidate; } catch { /* try the next build */ }
    }
    return null;
}

/** key: value pairs — double or single quoted keys, or bare identifiers. */
const KEY_PAT   = '(?:"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\'\\\\]|\\\\.)*)\'|([A-Za-z_][A-Za-z0-9_]*))';
const VALUE_PAT = '(?:"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\'\\\\]|\\\\.)*)\'|(-?[0-9]+(?:\\.[0-9]+)?))';
const PAIR_RE = new RegExp(`${KEY_PAT}\\s*:\\s*${VALUE_PAT}`, 'g');

/**
 * Last resort for output that is not JSON at all — Python-style single quotes,
 * unquoted keys, missing braces. Reads the pairs out of every innermost object
 * and rebuilds questions from the same aliases coerceQuestions understands.
 */
function salvagePairs(text) {
    const chunks = String(text || '').match(/\{[^{}]*\}/g) || [];
    const items = [];

    for (const chunk of chunks) {
        const item = {};
        PAIR_RE.lastIndex = 0;
        let m;
        while ((m = PAIR_RE.exec(chunk)) !== null) {
            const key = String(m[1] ?? m[2] ?? m[3] ?? '').trim().toLowerCase();
            if (!key || item[key] !== undefined) continue;
            item[key] = m[4] ?? m[5] ?? m[6] ?? '';
        }
        if (Object.keys(item).length) items.push(item);
    }
    return coerceQuestions(items);
}

/** JSON.parse that returns undefined instead of throwing. */
function tryJson(text) {
    try { return JSON.parse(text); } catch { return undefined; }
}

/** Pull the question list out of a parsed object; null when there is none. */
function fromObject(obj) {
    const list = obj?.questions ?? obj?.answers ?? obj?.results ?? obj?.items
        ?? (Array.isArray(obj) ? obj : null);
    const questions = coerceQuestions(list);
    const unreadable = Array.isArray(obj?.unreadable) ? obj.unreadable.map(oneLine).filter(Boolean) : [];
    // An explicit "nothing readable" is still an answer — the caller reports it
    // instead of dumping the raw JSON into the group.
    if (!questions.length && !unreadable.length) return null;
    return { questions, unreadable };
}

/**
 * @returns {{questions:Array, unreadable:Array, raw:string, parsed:boolean, repaired:boolean}}
 */
export function parseQuizResult(text) {
    const raw = String(text || '');
    const base = { raw, unreadable: [], parsed: false, questions: [], repaired: false };

    const cleaned = stripFences(raw);
    const candidates = [cleaned];
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));

    // 1. strict JSON — the happy path (and prose wrapped around it)
    for (const candidate of candidates) {
        const found = fromObject(tryJson(candidate));
        if (found) return { ...base, ...found, parsed: true };
    }

    // 2. the document is broken: close the truncated tail and try again
    const repairedSrc = repairJson(cleaned);
    if (repairedSrc) {
        const found = fromObject(tryJson(repairedSrc));
        if (found) {
            const unreadable = [...found.unreadable];
            // The final question lost its answer to the token limit. Showing
            // "could not determine" for it is worse than admitting it is missing.
            const tail = found.questions[found.questions.length - 1];
            if (tail && !tail.answer) {
                found.questions.pop();
                unreadable.push(`Q${tail.n} — cut off before the answer`);
            }
            return { ...base, ...found, unreadable, parsed: true, repaired: true };
        }
    }

    // 3. not JSON at all, but the pairs are still readable
    const pairs = salvagePairs(cleaned);
    if (pairs.length) return { ...base, questions: pairs, parsed: true, repaired: true };

    // 4. numbered prose
    const salvaged = salvageFromProse(raw);
    if (salvaged.length) return { ...base, questions: salvaged, parsed: true };

    return base;
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function answerKeyLine(q) {
    const label = q.answer || '—';
    return `${q.n}) ${label.length > 60 ? `${label.slice(0, 57)}…` : label}`;
}

/**
 * @returns {string|null} null when there is nothing usable to send
 */
export function renderQuiz({ questions, unreadable = [], provider, model, ms, truncated = false }) {
    if (!questions?.length) return null;

    // One section per question so the layout is always
    //   question / one-line reason / answer  — repeated in order.
    const sections = [`*Quiz solved* · ${questions.length} question${questions.length === 1 ? '' : 's'}`];

    for (const q of questions) {
        const block = [`*Q${q.n}.* ${q.question || '_(question text not readable)_'}`];
        if (q.reason) block.push(`💡 ${q.reason}`);
        block.push(`✅ *${q.answer || '— could not determine —'}*`);
        sections.push(block.join('\n'));
    }

    if (unreadable.length) {
        sections.push(`⚠️ *Could not read:* ${unreadable.join(' · ')}`);
    }

    if (truncated) {
        sections.push('⚠️ _The answer hit the model output limit — later questions may be missing._');
    }

    sections.push(`━━ *Answer key* ━━\n${questions.map(answerKeyLine).join('\n')}`);

    const meta = [provider, model, typeof ms === 'number' ? `${(ms / 1000).toFixed(1)}s` : null]
        .filter(Boolean)
        .join(' · ');
    if (meta) sections.push(`_${meta}_`);

    return sections.join('\n\n');
}

// ─── Chunking ────────────────────────────────────────────────────────────────
/**
 * Split on blank lines (i.e. never mid-question) and pack up to `max` chars.
 * A single oversized block is hard-split on a word boundary.
 */
export function chunkText(text, max = MAX_MESSAGE) {
    const body = String(text || '');
    if (body.length <= max) return body ? [body] : [];

    const hardSplit = (s) => {
        const out = [];
        let rest = s;
        while (rest.length > max) {
            let cut = rest.lastIndexOf('\n', max);
            if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
            if (cut < max * 0.5) cut = max;
            out.push(rest.slice(0, cut).trimEnd());
            rest = rest.slice(cut).trimStart();
        }
        if (rest) out.push(rest);
        return out;
    };

    const chunks = [];
    let current = '';

    for (const block of body.split(/\n\n+/)) {
        const piece = block.length > max ? null : block;
        if (piece === null) {
            if (current) { chunks.push(current.trim()); current = ''; }
            chunks.push(...hardSplit(block));
            continue;
        }
        if (!current) { current = piece; continue; }
        if (current.length + piece.length + 2 > max) {
            chunks.push(current.trim());
            current = piece;
        } else {
            current += `\n\n${piece}`;
        }
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks.map((c, i) => (chunks.length > 1 ? `${c}\n\n_(${i + 1}/${chunks.length})_` : c));
}

export { MAX_MESSAGE };
export default { parseQuizResult, renderQuiz, chunkText };
