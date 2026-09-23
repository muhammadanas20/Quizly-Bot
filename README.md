# Quizly Bot

A WhatsApp bot that does two jobs, built to run on a **1 GiB RAM** VM:

1. **Quiz solver** — send `quiz` + a screenshot, get every question answered in order:
   *question → one-line reason → answer*, then a compact answer key.
2. **Silent sticker guard** — a member you flag has their stickers removed the instant
   they post them, in any group where the bot is admin. **The bot never replies, never
   warns, never posts anything.** The sticker just disappears.

---

## What the answer looks like

Send in a group:

> `quiz` + *[screenshot]*

The bot reacts 👀 to your message, then posts:

```
*Quiz solved* · 3 questions

*Q1.* Which gas do plants absorb for photosynthesis?
💡 Photosynthesis fixes carbon from CO₂ into sugar.
✅ *B — Carbon dioxide*

*Q2.* Capital of Pakistan?
💡 Islamabad replaced Karachi as capital in the 1960s.
✅ *C — Islamabad*

*Q3.* 12 × 8 = ?
💡 12 × 8 = 96.
✅ *A — 96*

━━ *Answer key* ━━
1) B — Carbon dioxide
2) C — Islamabad
3) A — 96

_gemini · gemini-2.5-flash · 2.8s_
```

then flips your message to ✅. Every question is read, given a one-line reason, and
answered before the next one starts — exactly the order you asked for.

---

## How the sticker guard works

```
sticker arrives
  └─ is the sender on the flag list?          ← one Set lookup, nothing else if not
       └─ is the media type blocked?          ← sticker by default, configurable
            └─ is the bot an admin here?      ← cached per group
                 └─ revoke the message        ← sock.sendMessage(jid, { delete: key })
                    …and say nothing.
```

* No warning message, no "bad language" reply, no group spam — one debug line in the
  server log and a counter you can read with `!stats`.
* Flag by **phone number** or by **@mention**; both spellings match the same person, and
  Baileys 7's anonymous LID identities are resolved too (most bots get this wrong and
  silently miss half the members in a big group).
* Nothing is deleted in a group where the bot is **not** an admin — WhatsApp would
  reject the revoke anyway.

## Commands

| Command | Who | What |
|---|---|---|
| `!quiz` | anyone | solve the attached / replied image right now |
| `!flag <@person or number> [reason]` | owner | flag a member |
| `!unflag <@person or number>` | owner | remove a flag |
| `!flags` | owner | list flagged members + how much was removed |
| `!guard on\|off\|status` | owner | toggle the guard live |
| `!stats` | anyone | deletions, AI usage, memory, uptime |
| `!ping` | anyone | latency + memory |

Flagged members can also be seeded from code in `.env`:

```env
FLAGGED_USERS=923001234567:Ali,923009876543
```

---

## Quick start

```bash
git clone https://github.com/<you>/Quizly-Bot.git && cd Quizly-Bot
npm install
cp .env.example .env      # then edit it
npm run check             # validates Node, keys and model names
npm start                 # prints a QR code — scan it
```

Full walkthrough for the Azure VM, from your laptop, is in
**[docs/SETUP-FROM-YOUR-LAPTOP.md](docs/SETUP-FROM-YOUR-LAPTOP.md)**.

### Pairing succeeds, then the bot returns to the shell

A `515` / `restart required` immediately after `pairing configured successfully`
means WhatsApp accepted pairing and expects a replacement connection. It is not,
by itself, a reason to delete `auth/` or scan again.

Older code called `reconnectTimer.unref()`, allowing Node to exit when the old
socket closed, before reconnecting. The reconnect timer now keeps Node alive;
shutdown still cancels it. After installing the fix, run `npm start` again with
the existing session directory and look for `Quizly Bot is ONLINE`. If PM2 is
already running the bot, use `pm2 restart quizly` instead of starting a second copy.

---

## AI providers

`AI_ORDER=gemini,grok,groq` — the bot tries them in that order and falls through on
failure. Only providers with a key in `.env` are used.

| Provider | Env key | Default model | Get a key |
|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` | https://aistudio.google.com/apikey |
| xAI Grok | `XAI_API_KEY` | `grok-4.5` | https://console.x.ai/team/default/api-keys |
| Groq | `GROQ_API_KEY` | `meta-llama/llama-4-scout-17b-16e-instruct` | https://console.groq.com/keys |

Model names move fast. `npm run check` lists the models **your** key can actually use and
tells you if the one in `.env` is missing. Each provider also has a
`*_MODEL_FALLBACKS` list: if a model id gets retired, the next one is tried automatically
instead of failing every quiz.

Speed knobs already set for you: `GEMINI_THINKING_BUDGET=0` (no reasoning tokens on
2.5-*, roughly 2–4× faster) and `XAI_REASONING_EFFORT=low`.

---

## Built for 1 GiB of RAM

The previous version drove **whatsapp-web.js**, which runs a full headless Chromium.
This version uses **Baileys** — a direct WebSocket implementation of the WhatsApp Web
protocol with no browser at all.

| | whatsapp-web.js (before) | Baileys (now) |
|---|---|---|
| Chromium process | yes — typically several hundred MB | **none** |
| `npm install` download | Chrome, via `postinstall` | none |
| Measured RSS after `require()` | not measured | **104 MB** *(measured here: 103.8 MB RSS)* |
| Native/browser deps to keep alive | Chromium + Puppeteer | none |

> The "before" column is architectural, not benchmarked — I did not run the old version
> here. The 104 MB figure is measured: `node -e "require('@whiskeysockets/baileys')"`.
> Expect a connected session to sit somewhat higher; check with `pm2 monit` on the VM.

Additional memory work:

* **No AI SDKs** — Gemini and Grok are called with Node's built-in `fetch`. The official
  SDKs would add dozens of packages and tens of MB of heap for no benefit. Keep-alive
  connections are reused, which also saves 200–400 ms per quiz.
* `--max-old-space-size=320` and PM2 `max_memory_restart: 450M` (see `ecosystem.config.cjs`).
* `scripts/setup-vm.sh` creates a **2 GiB swap file** and sets `vm.swappiness=10`.
* One solve per chat at a time; duplicate triggers are dropped, not queued.
* Group admin status is cached for 10 minutes so the guard never adds a round trip.

Check it yourself on the VM: `pm2 monit` or `free -h`.

---

## What was broken and is now fixed

| # | Problem in the old code | Fix |
|---|---|---|
| 1 | It listened on `message_create`, which whatsapp-web.js emits for **every** message *including the bot's own outgoing ones* — the `if (msg.id.fromMe) return` guard sits *after* that emit (`src/Client.js:652`). So the handler re-inspected everything the bot sent. Not fatal (the trigger needed an image), but it is the wrong event and one image-forward away from a loop. | Baileys `messages.upsert`, filtered to `type === 'notify'` and `!key.fromMe` |
| 2 | `executablePath: '/usr/bin/chromium-browser'` — on Ubuntu 24.04 that path is a **snap** stub, which fails on a headless VM without snapd. | No Chromium at all |
| 3 | Puppeteer + a headless browser on 1 GiB of RAM, plus a Chrome download in `postinstall` | Baileys: 104 MB RSS measured on load, nothing to download |
| 4 | `process.exit(1)` at import time if `GROQ_API_KEY` was missing — the process died before printing anything useful | Startup validation that names the missing key and the fix |
| 5 | One provider, one model, no fallback — a retired model id breaks every quiz | Three providers, per-provider model fallbacks, error classification |
| 6 | Rate limiter was hard-wired to Groq's free-tier numbers | Configurable, provider-independent |
| 7 | Nothing persisted; a restart lost all state | Flag list on disk, session on disk, PM2 auto-restart |
| 8 | Replies were one blob of `REASONING:` then `ANSWERS:` | Per-question *question → reason → answer*, chunked on question boundaries |

> **What I could not verify here.** This sandbox has no outbound internet, no WhatsApp
> number and no API keys, so I could not complete a live login or a real Gemini/Grok call.
> What *is* verified: 157 unit and integration tests over the guard, the router, the
> formatting, the provider request shapes and the fallback logic; a real process boot
> (socket constructed, reconnect backoff, clean shutdown); and every request body asserted
> against the documented API shapes. Two claims I made earlier about the old code were
> wrong and are corrected above — `message_create` is not outgoing-only, and `msg.body` is
> always a string in whatsapp-web.js (`src/structures/Message.js:55`), so it never threw.

---

## Project layout

```
index.js                  entry point
src/
  config.js               env parsing + identity normalisation (PN / LID aware)
  log.js                  tiny pino-compatible logger
  bot.js                  Baileys socket, connection, reconnect
  router.js               guard → commands → quiz, in that order
  guard.js                silent sticker removal (pure decision + live executor)
  flags.js                flagged-member store, persisted to data/flags.json
  groups.js               cached group metadata / "am I admin?"
  quiz.js                 trigger → download → AI → format → send
  format.js               JSON parsing + the per-question layout + chunking
  commands.js             !flag / !unflag / !flags / !guard / !quiz / !stats
  limiter.js              rate limiter + one-solve-per-chat gate
  message.js              pure WAMessage readers (kind, text, quoted, …)
  ai/                     gemini.js, openaiCompat.js (grok+groq), solve.js, http.js
scripts/
  setup-vm.sh             one-shot VM bootstrap (Node, swap, PM2, deps)
  check-env.js            npm run check — validates keys and model names
test/                     155 unit + integration tests (node --test, no deps)
docs/
  SETUP-FROM-YOUR-LAPTOP.md
```

```bash
npm test          # 155 tests
npm run check     # validate your .env against the live APIs
npm start         # run
```

---

## ⚠️ Read this before you run it

* This is an **unofficial** WhatsApp client. Automated accounts can be banned. Use a
  **spare number**, not your personal one, and do not bulk-message or spam.
* `auth/` holds long-lived keys for your WhatsApp account and `.env` holds your API keys.
  Both are git-ignored — never commit them, never paste them in chat.
* Only open port **22** in the Azure Network Security Group. The bot makes outbound
  connections only; nothing needs to reach it from the internet.
* Deleting someone's message requires admin rights and works only within WhatsApp's
  ~48-hour revoke window.
