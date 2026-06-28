/**
 * index.js — WA Quiz Solver
 *
 * HOW IT WORKS:
 * 1. Starts a WhatsApp session (shows QR code on first run).
 * 2. Listens to every group message (including your own).
 * 3. Triggers ONLY when 2 conditions are met:
 *       a) The message body contains the word "quiz"
 *       b) The message has an attached image
 * 4. Sends "Solving..." immediately to prevent spam re-triggers.
 * 5. Sends the image to Groq AI with a strict format prompt.
 * 6. Replies with REASONING first, ANSWERS below.
 *
 * ── REMOVED FEATURES ──────────────────────────────────────────────────────────
 * @mention-all: Previously tagged every group member on every answer.
 * Removed because:
 *   - Spams all members on every quiz, not just those who asked
 *   - Bulk-tagging is a known trigger for WhatsApp banning bot numbers
 *   - Resolving all contacts adds latency and can fail silently
 */

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode                = require('qrcode-terminal');
const { solveQuiz }         = require('./aiHandler');
const { checkRateLimit, recordRequest, getStats } = require('./rateLimiter');

// ─── WhatsApp Client Setup ────────────────────────────────────────────────────
const os = require('os');

// Auto-detect platform so the same code works on both Windows and Linux
const isLinux = os.platform() === 'linux';

const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions'
];

const client = new Client({
    authStrategy  : new LocalAuth(),
    authTimeoutMs : 0,   // 0 = wait forever — never timeout on QR scan or auth
    qrTimeoutMs   : 0,   // 0 = QR code never expires on bot's side
    puppeteer: {
        headless        : true,
        protocolTimeout : 300000,  // ← THIS is the fix. 5 min for slow servers
        timeout         : 60000,   // 60s to launch Chrome itself
        // Only use system Chromium on Linux — let Windows use bundled Chrome
        ...(isLinux && { executablePath: '/usr/bin/chromium-browser' }),
        args: puppeteerArgs
    }
});

// ─── Event: QR Code (first login only) ───────────────────────────────────────
client.on('qr', (qr) => {
    console.log('\n📱  Scan this QR code with WhatsApp to log in:');
    console.log('    (Open WhatsApp → Menu → Linked Devices → Link a Device)\n');
    qrcode.generate(qr, { small: true });
    console.log('\n⚠️   QR code expires in ~20 seconds. Restart the bot if it expires.\n');
});

// ─── Event: Bot is ready ─────────────────────────────────────────────────────
client.on('ready', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅  WA Quiz Solver is ONLINE');
    console.log(`  📞  Bot number  : ${client.info.wid.user}`);
    console.log(`  🤖  AI model    : ${process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'}`);
    console.log('  🎯  Trigger     : "quiz" + image');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// ─── Event: Auth failure ──────────────────────────────────────────────────────
client.on('auth_failure', (msg) => {
    console.error('\n❌  WhatsApp authentication failed:', msg);
    console.error('    Fix: delete the .wwebjs_auth folder, then restart.\n');
    process.exit(1);
});

// ─── Event: Disconnected ─────────────────────────────────────────────────────
client.on('disconnected', (reason) => {
    console.warn(`\n⚠️   Bot disconnected. Reason: ${reason}`);
    console.warn('    Restart the bot to reconnect.\n');
});

// ─── Event: Incoming & Outgoing message ──────────────────────────────────────
client.on('message_create', async (msg) => {
    try {
        await handleMessage(msg);
    } catch (err) {
        // Catch-all so one broken message never kills the entire bot process
        console.error('\n❌  Unhandled error in message handler:', err.message);
    }
});

// ─── Core Handler ─────────────────────────────────────────────────────────────
async function handleMessage(msg) {
    const chat = await msg.getChat();

    // ── 1. Only process group chats ───────────────────────────────────────────
    if (!chat.isGroup) return;

    // ── 2. Trigger Conditions ─────────────────────────────────────────────────
    //    Both must be true — missing either one = ignore the message.
    const hasKeyword = msg.body.toLowerCase().includes('quiz');
    const hasImage   = msg.hasMedia;

    if (!hasKeyword || !hasImage) return;

    // ── 3. All triggers met — log it ──────────────────────────────────────────
    const time  = new Date().toLocaleTimeString();
    const stats = getStats();
    console.log(`\n[${time}] 🎯  Quiz triggered in group: "${chat.name}"`);
    console.log(`         Rate usage → ${stats.lastMinute} per-min | ${stats.lastDay} per-day`);

    // ── 4. Rate Limit Gate ────────────────────────────────────────────────────
    const limitStatus = checkRateLimit();
    if (!limitStatus.allowed) {
        await msg.reply(`⏳ *Rate limit reached.*\n${limitStatus.reason}`);
        console.log(`         ⛔  Blocked: ${limitStatus.reason}`);
        return;
    }

    // ── 5. Immediate "Processing" reply ──────────────────────────────────────
    await msg.reply('*Solving the quiz...* Answer coming in a few seconds.');

    // ── 6. Download the image ─────────────────────────────────────────────────
    let media;
    try {
        media = await msg.downloadMedia();
    } catch (downloadErr) {
        await msg.reply('❌ Failed to download the image. Try sending it again.');
        console.error('         Download error:', downloadErr.message);
        return;
    }

    if (!media) {
        await msg.reply('❌ Image could not be read. Try again with a clearer screenshot.');
        return;
    }

    if (!media.mimetype.startsWith('image/')) {
        await msg.reply('❌ Only image files work. Send a screenshot or photo of the quiz.');
        return;
    }

    // ── 7. Send image to Groq AI ──────────────────────────────────────────────
    console.log(`         📤  Sending image to Groq (${media.mimetype})...`);
    const result = await solveQuiz(media);

    if (!result.success) {
        await msg.reply(
            `❌ *AI could not solve the quiz.*\n` +
            `Reason: _${result.error}_\n\n` +
            `💡 *Common fixes:*\n` +
            `• Send a high-resolution, well-lit screenshot\n` +
            `• Avoid forwarded/compressed images — screenshot directly\n` +
            `• Make sure quiz text is clearly visible`
        );
        console.error(`         ❌  AI failed: ${result.error}`);
        return;
    }

    // Record this as a successful API call ONLY after success
    recordRequest();
    console.log('         ✅  AI responded. Sending to group...');

    // ── 8. Send final answer — no @mention-all (removed, see top of file) ─────
    await chat.sendMessage(result.answer);
    console.log(`         📨  Done. Answer sent to "${chat.name}"`);
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log('\n🚀  Starting WA Quiz Solver...\n');
client.initialize();
