#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  setup-vm.sh — one-shot bootstrap for the Azure VM (Ubuntu 24.04, 1 GiB RAM)
#
#  Run it from inside the cloned repository:
#      cd ~/Quizly-Bot && bash scripts/setup-vm.sh
#
#  It is idempotent: re-running it skips whatever is already done.
#
#  What it does
#    1. Node.js 22 LTS (NodeSource)
#    2. 2 GiB swap file   ← essential: 1 GiB RAM alone is not comfortable
#    3. vm.swappiness=10  ← prefer RAM, touch swap only under pressure
#    4. PM2 + systemd auto-start on boot
#    5. npm install for this project
#
#  It does NOT touch the firewall. Azure's Network Security Group is already
#  your firewall; if you want ufw as well, run:  bash scripts/setup-vm.sh --firewall
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; YEL='\033[1;33m'; RED='\033[0;31m'; OFF='\033[0m'
step() { printf "\n${GREEN}==> %s${OFF}\n" "$1"; }
note() { printf "    %s\n" "$1"; }
warn() { printf "${YEL}  ! %s${OFF}\n" "$1"; }
die()  { printf "${RED}  x %s${OFF}\n" "$1" >&2; exit 1; }

# ── who am I ─────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    die "Run with sudo:  sudo bash scripts/setup-vm.sh"
fi

RUN_USER="${SUDO_USER:-root}"
[[ "$RUN_USER" == "root" ]] && warn "SUDO_USER not set — installing PM2 autostart for root."
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
note "user=$RUN_USER home=$RUN_HOME repo=$REPO_DIR"

WANT_FIREWALL=0
for arg in "$@"; do [[ "$arg" == "--firewall" ]] && WANT_FIREWALL=1; done

# ── 0. base packages ─────────────────────────────────────────────────────────
step "Updating package lists"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git >/dev/null
note "base packages ready"

# ── 1. Node.js 22 ────────────────────────────────────────────────────────────
step "Node.js"
if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; then
    note "already installed: $(node -v)"
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
    note "installed $(node -v) / npm $(npm -v)"
fi
node -v >/dev/null || die "Node install failed"

# ── 2. swap ──────────────────────────────────────────────────────────────────
step "Swap (2 GiB)"
if swapon --show=NAME --noheadings | grep -q .; then
    note "swap already active:"; swapon --show | sed 's/^/      /'
else
    # Abort early if the OS disk is too small to hold the swap file.
    AVAIL_KB=$(df -Pk / | awk 'NR==2 {print $4}')
    if (( AVAIL_KB < 3000000 )); then
        warn "Less than ~3 GB free on / — skipping swap. Free up disk space and re-run."
    else
        fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
        swapon /swapfile
        grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
        note "created and enabled /swapfile (2 GiB)"
    fi
fi

# ── 3. kernel tuning ─────────────────────────────────────────────────────────
step "Kernel tuning"
cat >/etc/sysctl.d/99-quizly.conf <<'EOF'
# Prefer real RAM; only swap when genuinely under pressure.
vm.swappiness=10
# Keep more dentries/inodes cached — cheap on a low-traffic bot.
vm.vfs_cache_pressure=50
EOF
sysctl --system >/dev/null
note "swappiness=$(cat /proc/sys/vm/swappiness)"

# ── 4. PM2 ───────────────────────────────────────────────────────────────────
step "PM2"
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2 --silent
    note "installed pm2 $(pm2 -v)"
else
    note "already installed: pm2 $(pm2 -v)"
fi

note "enabling PM2 to start at boot for $RUN_USER"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$RUN_USER" --hp "$RUN_HOME" >/dev/null 2>&1 || \
    warn "pm2 startup failed — run 'pm2 startup' manually and follow the printed command"

# ── 5. project dependencies ──────────────────────────────────────────────────
step "Installing project dependencies"
cd "$REPO_DIR"
chown -R "$RUN_USER":"$RUN_USER" "$REPO_DIR" 2>/dev/null || true
sudo -u "$RUN_USER" bash -lc "cd '$REPO_DIR' && npm install --omit=dev --no-audit --no-fund"
note "dependencies installed"

# ── 6. optional firewall ─────────────────────────────────────────────────────
if [[ $WANT_FIREWALL -eq 1 ]]; then
    step "ufw"
    apt-get install -y -qq ufw >/dev/null
    ufw allow OpenSSH
    ufw --force enable
    note "ufw enabled, SSH allowed"
fi

# ── done ─────────────────────────────────────────────────────────────────────
step "Done"
cat <<EOF

  Next steps (as $RUN_USER, not root):

    cd $REPO_DIR
    cp .env.example .env          # then edit it: nano .env
    npm run check                 # verify keys + Node before starting
    npm start                     # prints the QR code — scan it with your phone

  Once it says "Quizly Bot is ONLINE", stop it with Ctrl+C and run it under PM2:

    pm2 start ecosystem.config.cjs
    pm2 save                      # ← required for it to come back after a reboot
    pm2 logs quizly

  Handy:
    free -h            memory + swap
    pm2 monit          live CPU/RAM for the bot
    pm2 restart quizly

EOF
