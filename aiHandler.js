/**
 * aiHandler.js
 *
 * Handles all communication with the Groq API (Llama vision model).
 * Output format: REASONING first, ANSWERS below — so you can verify
 * the logic before trusting the answer.
 */

const Groq = require('groq-sdk');

// ─── Validate API key at startup, not at first use ────────────────────────────
if (!process.env.GROQ_API_KEY) {
    console.error('\n❌  GROQ_API_KEY is missing or not set in your .env file.');
    console.error('    Get a free key at: https://console.groq.com/keys\n');
    process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Prompt: reasoning-first so you can spot wrong logic before the answer ────
const QUIZ_PROMPT = `You are an expert quiz solver. Your only job is to read the quiz in the provided image and return the correct answers.

STRICT OUTPUT RULES — follow exactly, no exceptions:
- Do NOT greet the user.
- Do NOT add any extra commentary outside the two sections below.

Use this exact structure:

*REASONING:*
[For each question, briefly explain WHY that answer is correct. Be concise and clear.]

*ANSWERS:*
[List each correct answer, numbered. If multiple choice, state the option letter AND the answer text.]
[Example: "1. B — Photosynthesis"]
`;

// ─── Main function: send image to Groq, return structured result ───────────────
async function solveQuiz(media) {
    try {
        const response = await groq.chat.completions.create({
            model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${media.mimetype};base64,${media.data}`
                            }
                        },
                        {
                            type: 'text',
                            text: QUIZ_PROMPT
                        }
                    ]
                }
            ],
            temperature : 0.3,   // Low = accurate and consistent
            max_tokens  : 1024   // Enough for any reasonable quiz
        });

        const text = response.choices[0]?.message?.content?.trim();

        if (!text || text.length === 0) {
            return {
                success : false,
                error   : 'AI returned an empty response. The image may be unreadable.'
            };
        }

        return { success: true, answer: text };

    } catch (err) {
        console.error('  Groq raw error:', err.message);
        return { success: false, error: translateError(err) };
    }
}

// ─── Convert API errors into plain-language messages ──────────────────────────
function translateError(err) {
    const msg = (err.message || '').toLowerCase();

    if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota'))
        return 'Groq rate limit hit. Wait 60 seconds and try again.';

    if (msg.includes('resource_exhausted'))
        return 'Daily quota exhausted. Resets at midnight UTC.';

    if (msg.includes('safety') || msg.includes('blocked'))
        return 'Image was blocked by safety filters. Try a different image.';

    if (msg.includes('api_key') || msg.includes('invalid_argument') || msg.includes('unauthenticated') || msg.includes('unauthorized'))
        return 'Invalid Groq API key. Check your .env file.';

    if (msg.includes('service_unavailable') || msg.includes('503'))
        return 'Groq is temporarily down. Try in 5 minutes.';

    if (msg.includes('deadline_exceeded') || msg.includes('timeout'))
        return 'Request timed out. Image may be too large or complex.';

    if (msg.includes('model') && msg.includes('not found'))
        return 'Model not found. Check GROQ_MODEL in your .env file.';

    const raw = err.message || 'Unknown error';
    return raw.length > 120 ? raw.substring(0, 120) + '...' : raw;
}

module.exports = { solveQuiz };
