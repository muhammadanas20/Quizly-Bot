# Setting up Quizly Bot on your Azure VM — from your laptop

Everything below runs from **your computer**. You will never need the Azure portal again
except to check that the VM is running.

**Your VM**

| | |
|---|---|
| Name | `bot-hosting-vm` |
| Resource group | `bot-active-rg` |
| Public IP | `20.200.202.152` |
| Location | Korea Central |
| OS / Size | Ubuntu 24.04 · Standard B2ats v2 (2 vCPU, **1 GiB RAM**) |
| VM agent | Ready ✅ (so the "reset password" trick below works) |

Replace `azureuser` below with the username you picked when you created the VM.

---

## 1. Get SSH access from your laptop

### 1a. Make sure you can log in

If you don't remember the password (or never set one):

1. [portal.azure.com](https://portal.azure.com) → search **bot-hosting-vm** → open it.
2. Left menu → **Help + support** → **Reset password**.
3. Mode: **Reset password** → type the username (`azureuser`) and a strong new password → **Update**.
   Takes about 30 seconds. Your VM agent shows *Ready*, so this works without the old password.

> Prefer keys over passwords? On the same blade choose **Reset SSH public key** and paste
> the contents of your `~/.ssh/id_ed25519.pub` (create it in step 1d first).

### 1b. Confirm port 22 is open

VM → **Networking** (or *Settings → Networking*) → **Network settings** → **Inbound port rules**.

You need a rule allowing **TCP 22**. Azure normally creates `default-allow-ssh` for you.
If it's missing: **Create port rule → Inbound port rule** → Destination port ranges `22`,
Protocol `TCP`, Action `Allow`, Name `allow-ssh`.

**Nothing else needs to be open.** The bot only makes outbound connections.

### 1c. Connect

**Windows 10 / 11** — open **PowerShell** (the OpenSSH client is built in; check with `ssh -V`).
If `ssh` is missing: Settings → System → Optional features → Add a feature → **OpenSSH Client**.

**macOS / Linux** — open **Terminal**.

```bash
ssh azureuser@20.200.202.152
```

First time it asks:

```
The authenticity of host '20.200.202.152' can't be established.
ED25519 key fingerprint is SHA256:….
Are you sure you want to continue connecting (yes/no)?
```

Type `yes`, then your password. You're in when you see `azureuser@bot-hosting-vm:~$`.

> Korea Central is a long way from Pakistan — expect ~150–250 ms of typing lag. That is
> normal and does not affect the bot at all (the bot talks to WhatsApp's servers from the
> VM, not from your laptop).

### 1d. Log in with a key instead of a password (recommended)

On **your laptop**:

```bash
ssh-keygen -t ed25519 -C "quizly-laptop"      # press Enter to accept the default path
```

Then copy it to the VM:

```bash
# macOS / Linux
ssh-copy-id azureuser@20.200.202.152

# Windows PowerShell (no ssh-copy-id) — run this one line:
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh azureuser@20.200.202.152 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Now `ssh azureuser@20.200.202.152` asks for nothing. To switch off password logins
entirely, on the VM:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

⚠️ **Keep your current SSH session open** while you test a *new* login in a second window,
so you can't lock yourself out.

### 1e. If SSH won't connect at all

Portal → VM → **Help + support** → **Serial console** — a browser terminal straight into
the VM that does not need port 22. Use it to fix `sshd` or the firewall, then go back to SSH.

---

## 2. Make the IP permanent (2 minutes, do this)

If your public IP is **Dynamic**, it changes the next time the VM stops — and then your
`ssh` command and every script break.

1. VM → **Overview** → click the public IP link **bot-hosting-vm-ip**.
2. **Configuration** → **Assignment** → **Static** → **Save**.

The address stays `20.200.202.152` from then on. (Azure may bill a small hourly amount for
a static public IP — check the pricing line on that blade if you care; it is a few dollars
a month at most and comes out of your student credit.)

Optional, so you can use a name instead of an IP: same blade → **DNS name label** →
`quizly-anas` → Save. You can then `ssh azureuser@quizly-anas.koreacentral.cloudapp.azure.com`.

---

## 3. Get the code onto the VM

Still in your SSH session:

**If the repo is public**

```bash
cd ~
git clone https://github.com/muhammadanas20/Quizly-Bot.git
cd Quizly-Bot
git checkout arena/01a0cd62-quizly-bot     # this branch has the new version
```

**If it's private** — create a fine-grained Personal Access Token on GitHub
(Settings → Developer settings → Personal access tokens → *Contents: Read-only* for just
this repo), then:

```bash
git clone https://<YOUR_GITHUB_USERNAME>:<YOUR_TOKEN>@github.com/muhammadanas20/Quizly-Bot.git
cd Quizly-Bot && git checkout arena/01a0cd62-quizly-bot
```

> Delete the token from your shell history afterwards: `history -d $(history 1)`
> — or just use an SSH deploy key instead.

**No git? Push it from your laptop instead** (run this on *your* machine):

```bash
scp -r ./Quizly-Bot azureuser@20.200.202.152:~/Quizly-Bot
```

---

## 4. Bootstrap the VM (one command)

```bash
cd ~/Quizly-Bot
sudo bash scripts/setup-vm.sh
```

It installs Node.js 22, creates a **2 GiB swap file** (essential on 1 GiB of RAM), tunes
`vm.swappiness`, installs PM2, wires PM2 to start at boot, and runs `npm install`.
It is idempotent — re-running it skips what's already done.

Check it worked:

```bash
node -v        # v22.x
free -h        # a 2.0Gi line under Swap
pm2 -v
```

---

## 5. Configure `.env`

```bash
cd ~/Quizly-Bot
cp .env.example .env
nano .env
```

The four lines that actually matter:

```env
OWNER_NUMBERS=923xxxxxxxxx              # your number, digits only, no +
GEMINI_API_KEY=AIza…                    # https://aistudio.google.com/apikey
XAI_API_KEY=xai-…                       # https://console.x.ai/team/default/api-keys
FLAGGED_USERS=923xxxxxxxxx:Name         # optional: pre-flag someone from code
```

`nano`: edit, then **Ctrl+O**, **Enter** to save, **Ctrl+X** to exit.

Full list of settings with explanations: [`.env.example`](../.env.example).

---

## 6. Verify before you start

```bash
npm run check
```

You want to see:

```
  ✓ Node v22.x
  ✓ AI providers configured: gemini, grok
  ✓ key valid · 24 model(s) available
  ✓ "gemini-2.5-flash" is available
Everything looks good. Start it with:  npm start
```

If a model shows as not available, the command prints the candidates your key *can* use —
copy one into `.env`. The bot also falls back automatically, so this is a warning, not a
blocker.

---

## 7. Log in the WhatsApp number you want the bot to use

```bash
npm start
```

A QR code prints in your terminal. On the **phone that holds that number**:

**WhatsApp → Settings → Linked devices → Link a device → point the camera at the QR in your SSH window.**

Yes — scanning a QR on your laptop screen with your phone works fine.

The code refreshes every ~20 seconds automatically; if you miss one, a new one prints.
When you see this, you're done:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Quizly Bot is ONLINE
  📞  number   : 923xxxxxxxxx@s.whatsapp.net
  🎯  trigger  : "quiz" + image
  🚩  flagged  : 1 member(s)
  🛡️  guard    : ON (sticker)
  🧠  ai       : gemini → grok
  💾  memory   : 168 MB RSS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Stop it with **Ctrl+C**.

### Can't scan a QR? Use a pairing code instead

Add your number to `.env`:

```env
PHONE_NUMBER=923xxxxxxxxx
```

`npm start` then prints an 8-character code instead of a QR. In the app:
**Linked devices → Link a device → "Link with phone number instead"** → type the code.

> From now on the session is saved in `~/Quizly-Bot/auth/`. Restarting never asks for a
> QR again. If you ever remove the linked device from the phone, delete that folder and
> re-scan.

---

## 8. Run it 24/7 (survives reboots and crashes)

```bash
cd ~/Quizly-Bot
pm2 start ecosystem.config.cjs
pm2 save            # ← required, or it won't come back after a reboot
pm2 logs quizly     # live log (Ctrl+C to stop watching)
```

The config caps Node at 320 MB of heap and restarts the bot if it passes 450 MB RSS —
on a 1 GiB VM that catches a leak before the kernel's OOM killer does.

---

## 9. Make it work in your group

1. Add the bot's number to the group as a normal member.
2. **Promote it to admin** — required, otherwise WhatsApp refuses to let it delete
   anything and the guard silently does nothing.
3. Test the quiz: send a screenshot of a quiz with the word `quiz`.
4. Test the guard, as owner:
   ```
   !flag @SomeMember test
   ```
   Have that member send a sticker. It should vanish with **no message from the bot**.
   Then `!unflag @SomeMember`.
5. Check it counted: `!stats`.

---

## 10. Day-2 operations

```bash
pm2 logs quizly --lines 100     # what happened
pm2 restart quizly              # after changing .env or the code
pm2 monit                       # live CPU / RAM
free -h                         # RAM + swap
pm2 stop quizly                 # stop without removing
pm2 delete quizly               # remove from PM2 entirely
```

**Update the bot**

```bash
cd ~/Quizly-Bot
git pull
npm install --omit=dev
pm2 restart quizly
```

**Start completely fresh** (re-scan the QR)

```bash
pm2 stop quizly && rm -rf ~/Quizly-Bot/auth && pm2 restart quizly
```

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No QR appears, "connection errored" repeats | The VM cannot reach WhatsApp | `curl -I https://web.whatsapp.com` — if it fails, check the NSG **outbound** rules and DNS |
| QR keeps refreshing, never scans | Camera can't read the small QR | Enlarge the terminal font, or use the pairing code (step 7) |
| `WhatsApp logged this session out` | You removed the linked device, or WhatsApp revoked it | `rm -rf ~/Quizly-Bot/auth && pm2 restart quizly`, then re-scan |
| Bot answers quizzes but **won't delete stickers** | Not admin · guard off · not flagged · media type not blocked | `!guard status`, then check the bot is a group **admin**, the member is in `!flags`, and `GUARD_MEDIA` includes `sticker` |
| Bot deletes stickers but **says something** | It doesn't — by design it never replies | If you see a message, it came from another bot or the `!flag` confirmation |
| `❌ Could not solve that quiz` + "API key rejected" | Bad/expired key | `npm run check` |
| "model not found" | Provider retired the model id | `npm run check` shows valid ones; or rely on `*_MODEL_FALLBACKS` |
| Very slow answers | Large image, or a reasoning model | Set `XAI_REASONING_EFFORT=low`, `GEMINI_THINKING_BUDGET=0`, and optionally `npm i sharp` so big screenshots get downscaled |
| Bot restarts every few minutes | Out of memory | `free -h` — confirm swap exists; re-run `sudo bash scripts/setup-vm.sh` |
| SSH: `Connection timed out` | VM stopped, or port 22 closed | Portal → **Start**; check the NSG rule |
| SSH: `Permission denied` | Wrong user or password changed | Reset the password in the portal (step 1a) |
| IP changed after a restart | Public IP is Dynamic | Make it Static (step 2) |

---

## 12. Keeping the VM alive

* **Auto-shutdown is currently *Not enabled*** on your VM — good, it won't turn itself off.
  (Portal → VM → **Operations → Auto-shutdown** if you ever want to change that.)
* B-series VMs run on **CPU credits**. A bot that is idle 99% of the time accumulates
  credits and never runs out. Watch it under **Metrics → CPU Credits Remaining** if the
  bot ever feels slow after a long busy period.
* Azure for Students credits expire. Before they do, decide whether to keep the VM —
  a stopped/deallocated VM still charges for its disk and public IP.
* The bot needs ~150–250 MB resident. `free -h` should always show swap available.

---

## 13. Security checklist

- [ ] Port **22** is the only inbound rule in the NSG.
- [ ] You log in with an SSH **key**, and password auth is off.
- [ ] `.env` is **not** committed (`git status` should never list it).
- [ ] `~/Quizly-Bot/auth/` is not committed and not shared — it can control your WhatsApp account.
- [ ] The bot runs on a **spare number**, not your personal one.
- [ ] You are not bulk-messaging. Unofficial clients get banned for that.
