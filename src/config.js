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
// 'viewonce' is a one-time message whose media WhatsApp withheld, so its real
// type is unknowable; it is covered by any photo/video/audio rule anyway and
// listed here so `GUARD_MEDIA=…viewonce` / `!flag x media=…viewonce` validate.
export const GUARD_KINDS = ['sticker', 'image', 'video', 'gif', 'audio', 'document', 'link', 'viewonce', 'all'];
export const DEFAULT_GUARD_MEDIA = Object.freeze(['sticker', 'image']);

// ─── Companion (linked device) identity ──────────────────────────────────────
/**
 * WhatsApp decides who receives one-time media from the device class the bot
 * pairs as. Baileys derives it from `config.browser[1]`: anything that is not
 * "Android" is sent as `UserAgent.Platform.WEB` plus `webInfo`, i.e. a
 * web-class companion — and those get `<unavailable type="view_once"/>`
 * instead of the media.
 *
 *   web      default. Keeps an existing pairing working. One-time media is
 *            withheld, but the guard still revokes it blind (it needs only
 *            the message key).
 *   android  paired as a phone-class companion, so WhatsApp ships one-time
 *            media as well. Changes the device identity, so the session has
 *            to be paired once more after switching.
 */
export const COMPANION_KINDS = Object.freeze({
    web     : { kind: 'web',     label: 'web (Mac OS · Desktop)', receivesViewOnceMedia: false },
    android : { kind: 'android', label: 'android (phone-class)',  receivesViewOnceMedia: true }
});

/** @returns {{kind:string,label:string,receivesViewOnceMedia:boolean,name:string}} */
export function parseCompanion(raw, name) {
    const kind = String(raw || '').trim().toLowerCase();
    const picked = COMPANION_KINDS[kind] || COMPANION_KINDS.web;
    return { ...picked, name: String(name || '').trim() || 'Quizly Bot' };
}

/**
 * The Baileys `browser` tuple for a companion identity.
 *
 * Baileys keys the device class off `browser[1]`: `Browsers.android(name)` puts
 * 'Android' there (→ `UserAgent.Platform.ANDROID`, no `webInfo`, i.e. phone
 * class), everything else becomes `Platform.WEB`. `Browsers` is injected so
 * this stays free of a Baileys import in the config layer.
 */
export function companionBrowser(companion, Browsers) {
    return companion?.kind === 'android'
        ? Browsers.android(companion.name || 'Quizly Bot')
        : Browsers.macOS('Desktop');
}

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

        // Linked-device identity — decides whether WhatsApp sends one-time media
        companion       : parseCompanion(env.WA_BROWSER, env.WA_BROWSER_NAME),

        // Games (!game, !guess, !top, …)
        gamesEnabled    : bool(env.GAMES, true),
        // How long a round stays open before the bot reveals the answer.
        gameTimeoutMs   : (int(env.GAME_TIMEOUT, 180) || 180) * 1000,
        // Breather between two rounds in the same chat, so a round cannot be
        // farmed for participation points.
        gameCooldownMs  : (int(env.GAME_COOLDOWN, 15) || 15) * 1000,
        gameMaxAttempts : int(env.GAME_MAX_ATTEMPTS, 12) || 12,

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
    return valid.length ? valid : [...DEFAULT_GUARD_MEDIA];
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
    if (cfg.guardEnabled && cfg.companion && !cfg.companion.receivesViewOnceMedia) {
        warnings.push(
            'WA_BROWSER is web-class: WhatsApp withholds one-time (view-once) media from ' +
            'web-class linked devices; the guard still revokes those from the raw message ' +
            'stanza (a revoke only needs the key). Set WA_BROWSER=android and pair once more ' +
            'to also receive the media itself.'
        );
    }
    return { ok: errors.length === 0, errors, warnings, usableProviders: usable };
}

export default loadConfig;
