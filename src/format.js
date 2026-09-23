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
 * around it, or occasionally ignore the schema entirely. We try progressively
 * sloppier strategies and, as a last resort, hand the raw text straight to the
 * group so a weird reply never costs the user their answers.
 */

const MAX_MESSAGE = 3800;   // WhatsApp's text limit is 4096; keep a margin

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

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
        const m = line.match(/^(\d{1,2})[.)\-:]\s*(.*)$/);
        if (!m) continue;
        const body = m[2];
        const a = body.match(/(?:answer|ans|correct)\s*[:\-–]\s*(.+)$/i);
        found.push({
            n       : Number(m[1]),
            question: a ? body.slice(0, a.index).trim() : body,
            reason  : '',
            answer  : a ? oneLine(a[1]) : ''
        });
    }
    return found;
}

/**
 * @returns {{questions:Array, unreadable:Array, raw:string, parsed:boolean}}
 */
export function parseQuizResult(text) {
    const raw = String(text || '');
    const base = { raw, unreadable: [], parsed: false, questions: [] };

    const candidates = [];
    const cleaned = stripFences(raw);
    candidates.push(cleaned);
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));

    for (const candidate of candidates) {
        try {
            const obj = JSON.parse(candidate);
            const questions = coerceQuestions(obj?.questions ?? obj?.answers ?? obj?.results ?? obj?.items ?? (Array.isArray(obj) ? obj : null));
            if (questions.length) {
                const unreadable = Array.isArray(obj?.unreadable) ? obj.unreadable.map(oneLine).filter(Boolean) : [];
                return { ...base, questions, unreadable, parsed: true };
            }
        } catch { /* try the next candidate */ }
    }

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
export function renderQuiz({ questions, unreadable = [], provider, model, ms }) {
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
