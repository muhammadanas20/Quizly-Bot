/**
 * src/config.js — reads + validates the environment once, at startup.
 *
 * Everything is derived from a plain object so it can be unit-tested without
 * touching the real environment.
 */

// ─── Primitive parsers ───────────────────────────────────────────────────────
const has = (v) => v !== undefined && String(v).trim() !== '';

const bool = (v, fallback) =>
    has(v) ? /^(1|true|yes|on)$/i.test(String(v).trim()) : fallback;

const int = (v, fallback) => {
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const list = (v) =>
    String(v || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const digits = (s) => String(s || '').replace(/\D/g, '');

/** "00923001234567" → "923001234567": drop the international access prefix. */
function stripIdd(d) {
    return d.startsWith('00') && d.length > 8 ? d.slice(2) : d;
}

/**
 * Normalise any identity into a stable match key.
 *
 * Baileys 7 hands out two kinds of JID for the same human:
 *   - PN JID   "923001234567@s.whatsapp.net"  (may carry a ":12" device suffix)
 *   - LID JID  "123456789012345@lid"          (anonymous id used in big groups)
 *
 * Phone-number identities collapse to bare digits so that ".env" entries like
 * "+92 300 1234567", "0092 300 1234567" and "923001234567:2@s.whatsapp.net"
 * all match the same person.
 *
 * Every other server keeps its suffix — a group JID like "1203630-123@g.us"
 * must NEVER collapse to the same digits as some user's phone number, or the
 * guard could act on the wrong chat.
 */
export function normalizeId(raw) {
    if (!has(raw)) return '';
    const s = String(raw).trim().toLowerCase();

    if (s.includes('@')) {
        const at = s.lastIndexOf('@');
        const user = s.slice(0, at).split(':')[0];
        const server = s.slice(at + 1);
        if (!user) return '';
        if (server === 's.whatsapp.net') return stripIdd(digits(user));
        return `${user}@${server}`;          // lid, g.us, broadcast, newsletter, …
    }
    return stripIdd(digits(s));
}

/** All the normalised identities a single sender might be known by. */
export function idSet(...raws) {
    const out = new Set();
    for (const r of raws) {
        const n = normalizeId(r);
        if (n) out.add(n);
    }
    return out;
}

// ─── Media kinds the guard can act on ────────────────────────────────────────
export const GUARD_KINDS = ['sticker', 'image', 'video', 'gif', 'audio', 'document', 'link', 'all'];

// ─── Main loader ─────────────────────────────────────────────────────────────
export function loadConfig(env = process.env) {
    const cfg = {
        owners          : list(env.OWNER_NUMBERS).map(normalizeId).filter(Boolean),
        phoneNumber     : normalizeId(env.PHONE_NUMBER),

        // AI — Groq first: it answers a quiz image in about a second, so the
        // group sees the answer while Gemini/Grok are still warming up.
        aiOrder         : list(env.AI_ORDER || 'groq,gemini,grok'),
        aiTimeoutMs     : int(env.AI_TIMEOUT_MS, 60000) || 60000,
        // 1200 tokens runs out halfway through a 20-question quiz, which cuts
        // the JSON in half. The parser salvages what it can, but there is no
        // reason to make it: 2400 covers ~35 questions and costs nothing when
        // the answer is short (max_tokens is a ceiling, not a target).
        aiMaxTokens     : int(env.AI_MAX_TOKENS, 2400) || 2400,

        gemini: {
            key            : String(env.GEMINI_API_KEY || '').trim(),
            model          : String(env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
            fallbacks      : list(env.GEMINI_MODEL_FALLBACKS),
            // 0 disables "thinking" tokens on 2.5-* → noticeably faster + cheaper
            thinkingBudget : env.GEMINI_THINKING_BUDGET === undefined
                ? 0
                : int(env.GEMINI_THINKING_BUDGET, 0)
        },
        grok: {
            key            : String(env.XAI_API_KEY || env.GROK_API_KEY || '').trim(),
            model          : String(env.XAI_MODEL || 'grok-4.5').trim(),
            fallbacks      : list(env.XAI_MODEL_FALLBACKS),
            reasoningEffort: String(env.XAI_REASONING_EFFORT || 'low').trim()
        },
        groq: {
            key            : String(env.GROQ_API_KEY || '').trim(),
            model          : String(env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct').trim(),
            fallbacks      : list(env.GROQ_MODEL_FALLBACKS)
        },

        // Quiz
        quizTrigger     : String(env.QUIZ_TRIGGER || 'quiz').trim().toLowerCase(),
        allowPrivate    : bool(env.ALLOW_PRIVATE, true),
        ackMode         : ['react', 'text', 'none'].includes(String(env.ACK_MODE).toLowerCase())
            ? String(env.ACK_MODE).toLowerCase()
            : 'react',

        // Guard
        guardEnabled    : String(env.STICKER_GUARD || 'on').toLowerCase() !== 'off',
        guardMedia      : normaliseGuardMedia(env.GUARD_MEDIA),
        guardWhitelist  : list(env.GUARD_WHITELIST).map(normalizeId).filter(Boolean),
        seededFlags     : parseSeedFlags(env.FLAGGED_USERS),

        // Limits
        ratePerMinute   : int(env.RATE_PER_MINUTE, 12) || 12,
        ratePerDay      : int(env.RATE_PER_DAY, 800) || 800,

        // Paths
        sessionDir      : String(env.SESSION_DIR || './auth').trim(),
        dataDir         : String(env.DATA_DIR || './data').trim(),
        logLevel        : String(env.LOG_LEVEL || 'info').trim()
    };

    return cfg;
}

function normaliseGuardMedia(raw) {
    const picked = list(raw).map((s) => s.toLowerCase());
    const valid = picked.filter((k) => GUARD_KINDS.includes(k));
    return valid.length ? valid : ['sticker'];
}

/** "923001234567:Ali,923009876543" → [{ ids:Set, label:'Ali' }, ...] */
export function parseSeedFlags(raw) {
    return list(raw).map((entry) => {
        const [idPart, label] = entry.split(':');
        return { ids: idSet(idPart), label: String(label || '').trim() };
    }).filter((f) => f.ids.size > 0);
}

// ─── Startup validation ──────────────────────────────────────────────────────
/** Returns { ok, errors[], warnings[] } — never throws, so the caller decides. */
export function validateConfig(cfg) {
    const errors = [];
    const warnings = [];

    const usable = cfg.aiOrder.filter((p) => cfg[p]?.key);
    if (usable.length === 0) {
        errors.push(
            'No AI provider key found. Set at least one of GEMINI_API_KEY, ' +
            'XAI_API_KEY or GROQ_API_KEY in your .env file.'
        );
    }
    if (cfg.owners.length === 0) {
        warnings.push(
            'OWNER_NUMBERS is empty — nobody will be able to run !flag / !unflag / !guard.'
        );
    }
    if (!cfg.phoneNumber) {
        warnings.push('PHONE_NUMBER is empty — you will log in by scanning a QR code.');
    }
    return { ok: errors.length === 0, errors, warnings, usableProviders: usable };
}

export default loadConfig;
