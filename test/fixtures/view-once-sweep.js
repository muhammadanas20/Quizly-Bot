// Run in a child process. Boots the REAL startBot and feeds the socket's raw
// stanza emitter (`CB:message`) the current wire shape of a withheld one-time
// message from a FLAGGED member — the shape Baileys rc14 drops before
// `messages.upsert`. Reports whether the guard's raw-stanza sweep revoked it.
import { EventEmitter } from 'node:events';
import { startBot } from '../../src/bot.js';
import { loadConfig } from '../../src/config.js';

const [dir] = process.argv.slice(2);
const GROUP = '120363000000000000@g.us';
const FLAGGED = '923009876543@s.whatsapp.net';

const config = loadConfig({
    GEMINI_API_KEY : 'k',
    OWNER_NUMBERS  : '923001234567',
    FLAGGED_USERS  : '923009876543:Spammer'
});
config.dataDir = dir;
config.sessionDir = `${dir}/auth`;

const log = Object.fromEntries(
    ['info', 'warn', 'error', 'fatal', 'debug', 'raw'].map((level) => [level, () => {}])
);

const sent = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bot = await startBot({
    config,
    log,
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    socketFactory: () => {
        const ws = new EventEmitter();
        const socket = {
            ws,
            ev: new EventEmitter(),
            end: () => {},
            user: { id: '923001234567@s.whatsapp.net' },
            groupMetadata: async () => ({
                id: GROUP,
                subject: 'Study Group',
                participants: [
                    { id: '923001234567@s.whatsapp.net', admin: 'admin' },
                    { id: FLAGGED, admin: null }
                ]
            }),
            signalRepository: { lidMapping: { getPNForLID: () => undefined } },
            sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' } }; }
        };
        queueMicrotask(async () => {
            socket.ev.emit('connection.update', { connection: 'open' });
            await sleep(50);
            // the exact shape WhatsApp sends for a one-time photo this linked
            // device may not see: no <enc>, only the unavailable fanout node
            ws.emit('CB:message', {
                tag  : 'message',
                attrs: { id: 'LIVE1', from: GROUP, participant: FLAGGED, t: String(Math.floor(Date.now() / 1000)) },
                content: [{ tag: 'unavailable', attrs: { type: 'view_once_unavailable_fanout' } }]
            });
            await sleep(150);
            await bot.stop();
        });
        return socket;
    }
});

process.once('beforeExit', () => {
    console.log(JSON.stringify({ deletes: sent.map((s) => s.content.delete).filter(Boolean), viewOnce: bot.guard.stats.viewOnce }));
});
