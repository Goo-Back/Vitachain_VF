#!/usr/bin/env bash
# bootstrap-vps.sh — idempotent VPS bootstrap for VitaChain (INF-01)
#
# Run ONCE on a fresh Ubuntu 24.04 LTS VPS, as root:
#     scp infra/scripts/bootstrap-vps.sh root@<IP>:/root/
#     ssh root@<IP> 'bash /root/bootstrap-vps.sh "<PUBLIC_SSH_KEY>"'
#
# Re-runs are safe: every step checks state before mutating.
# All output is mirrored to /var/log/vitachain-bootstrap.log for forensics.

set -Eeuo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# 0) Config & logging
# ---------------------------------------------------------------------------
DEPLOY_USER="${DEPLOY_USER:-vitachain}"
PROJECT_DIR="${PROJECT_DIR:-/opt/vitachain}"
TIMEZONE="${TIMEZONE:-Africa/Casablanca}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
PUBLIC_SSH_KEY="${1:-}"
LOG_FILE="/var/log/vitachain-bootstrap.log"

log()  { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n'     "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n'      "$*" >&2; exit 1; }
trap 'die "failed at line $LINENO (exit $?)"' ERR

[[ $EUID -eq 0 ]] || die "Run as root."

# Tee everything (incl. stderr) into the log from this point forward.
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
log "===== $(date -uIs) — bootstrap starting (log: $LOG_FILE) ====="

# ---------------------------------------------------------------------------
# 1) OS sanity — this script ships ONLY the Ubuntu 24.04 path
# ---------------------------------------------------------------------------
[[ -f /etc/os-release ]] || die "/etc/os-release missing — refusing to run on unknown OS."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "Detected '${ID:-unknown}'. This script only supports Ubuntu."
case "${VERSION_ID:-}" in
    24.*) : ;;
    22.*) warn "Ubuntu ${VERSION_ID} — tested on 24.04. Continuing at your own risk." ;;
    *)    die  "Ubuntu ${VERSION_ID:-unknown} is not supported. Use 24.04 LTS." ;;
esac

# ---------------------------------------------------------------------------
# 2) Base packages
# ---------------------------------------------------------------------------
log "apt update + upgrade"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::="--force-confdef" \
               -o Dpkg::Options::="--force-confold" upgrade
apt-get -y -qq install \
    ufw fail2ban unattended-upgrades apt-listchanges \
    curl ca-certificates gnupg lsb-release \
    htop iotop tmux git vim rsync dnsutils jq unzip

# ---------------------------------------------------------------------------
# 3) Timezone + locale
# ---------------------------------------------------------------------------
log "timezone -> $TIMEZONE"
timedatectl set-timezone "$TIMEZONE" || warn "Could not set timezone."
locale-gen en_US.UTF-8 >/dev/null

# ---------------------------------------------------------------------------
# 4) journald — cap log volume (otherwise grows unbounded over months)
# ---------------------------------------------------------------------------
JOURNALD=/etc/systemd/journald.conf
if ! grep -qE '^SystemMaxUse=500M' "$JOURNALD"; then
    log "capping journald at 500M"
    sed -i 's/^#\?SystemMaxUse=.*/SystemMaxUse=500M/' "$JOURNALD"
    grep -qE '^SystemMaxUse=' "$JOURNALD" || echo 'SystemMaxUse=500M' >> "$JOURNALD"
    systemctl restart systemd-journald
fi

# ---------------------------------------------------------------------------
# 5) Swap
# ---------------------------------------------------------------------------
if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
    log "creating ${SWAP_SIZE_GB}G swapfile"
    fallocate -l "${SWAP_SIZE_GB}G" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
    log "swap already enabled — skipping"
fi
swapon --show=NAME --noheadings | grep -qx '/swapfile' || die "swap did not come up."

# ---------------------------------------------------------------------------
# 6) Deploy user
# ---------------------------------------------------------------------------
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
    log "creating user $DEPLOY_USER"
    adduser --disabled-password --gecos "" "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
else
    log "user $DEPLOY_USER exists — skipping"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"
AUTH_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$AUTH_KEYS"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

if [[ -n "$PUBLIC_SSH_KEY" ]]; then
    if ! grep -qF -- "$PUBLIC_SSH_KEY" "$AUTH_KEYS"; then
        echo "$PUBLIC_SSH_KEY" >> "$AUTH_KEYS"
        log "added supplied SSH key to $DEPLOY_USER"
    fi
elif [[ -s /root/.ssh/authorized_keys ]]; then
    # Inherit whatever the provider injected for root on first boot.
    cat /root/.ssh/authorized_keys >> "$AUTH_KEYS"
    sort -u -o "$AUTH_KEYS" "$AUTH_KEYS"
    log "inherited root's authorized_keys"
else
    warn "No SSH key supplied and /root/.ssh/authorized_keys is empty — $DEPLOY_USER has no key!"
fi

# Passwordless sudo so deploy.sh can run non-interactively. Validated with visudo.
SUDOERS_FILE="/etc/sudoers.d/90-$DEPLOY_USER"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"
visudo -c -f "$SUDOERS_FILE" >/dev/null || { rm -f "$SUDOERS_FILE"; die "bad sudoers fragment"; }

# ---------------------------------------------------------------------------
# 7) SSH hardening — apply ONLY after the deploy user has a key
# ---------------------------------------------------------------------------
if [[ -s "$AUTH_KEYS" ]]; then
    log "hardening sshd"
    SSHD=/etc/ssh/sshd_config
    cp -n "$SSHD" "$SSHD.bak.$(date +%Y%m%d)" || true

    declare -A SSH_SETTINGS=(
        [PermitRootLogin]=no
        [PasswordAuthentication]=no
        [KbdInteractiveAuthentication]=no
        [ChallengeResponseAuthentication]=no
        [PermitEmptyPasswords]=no
        [MaxAuthTries]=3
        [LoginGraceTime]=20
        [X11Forwarding]=no
        [ClientAliveInterval]=300
        [ClientAliveCountMax]=2
    )
    for key in "${!SSH_SETTINGS[@]}"; do
        val="${SSH_SETTINGS[$key]}"
        if grep -qE "^[#[:space:]]*${key}\b" "$SSHD"; then
            sed -i "s|^[#[:space:]]*${key}\b.*|${key} ${val}|" "$SSHD"
        else
            echo "${key} ${val}" >> "$SSHD"
        fi
    done

    sshd -t || die "sshd_config syntax check failed — not restarting ssh."
    systemctl restart ssh
else
    warn "Skipping SSH hardening — $DEPLOY_USER has no authorized_keys. You would lock yourself out."
fi

# ---------------------------------------------------------------------------
# 8) Firewall — idempotent (do NOT --force reset on re-run; preserves AUTH-08)
# ---------------------------------------------------------------------------
log "configuring UFW"
ufw_has() { ufw status | grep -qE "^${1}.*ALLOW"; }
if ! ufw status | grep -qE 'Status: active'; then
    ufw default deny incoming
    ufw default allow outgoing
fi
ufw_has '22/tcp'  || ufw allow 22/tcp
ufw_has '80/tcp'  || ufw allow 80/tcp
ufw_has '443/tcp' || ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban

# ---------------------------------------------------------------------------
# 9) Unattended security updates — explicit policy
#    Auto-apply security patches NIGHTLY. Do NOT auto-reboot — kernel reboots
#    must be manual to avoid surprising us mid-demo (PRD §13 R1, R3).
# ---------------------------------------------------------------------------
log "configuring unattended-upgrades (security only, no auto-reboot)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52unattended-upgrades-vitachain <<'EOF'
// VitaChain policy (INF-01): security patches only, no automatic reboot.
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades.service

# ---------------------------------------------------------------------------
# 10) Docker
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    log "installing Docker Engine"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    UBUNTU_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $UBUNTU_CODENAME stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get -y -qq install docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
else
    log "Docker already installed — skipping"
fi

# Add the deploy user to the docker group (no-op if already a member).
if ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$DEPLOY_USER"
    log "added $DEPLOY_USER to docker group (re-login required for it to take effect)"
fi
systemctl enable --now docker

# ---------------------------------------------------------------------------
# 11) Project directory
# ---------------------------------------------------------------------------
log "preparing $PROJECT_DIR (mode 750, owner $DEPLOY_USER)"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# 12) INF-06 — Let's Encrypt renewal cron (idempotent)
#
# Twice-daily renewal at 00:23 and 12:23 UTC — staggered minutes are
# Certbot upstream's own recommendation, to avoid the ACME mass-stampede
# at HH:00. Both windows fire the SAME renew-cert.sh; certbot exits 0
# immediately when no cert is within 30 days of expiry, so the cost on
# days nothing's due is a few hundred milliseconds.
#
# Why host cron (not a sidecar timer container)? The host's cron daemon
# survives Docker daemon restarts. A container-internal cron daemon does
# not. This is the canonical Certbot-Docker deployment pattern.
#
# A pre-created log file with the deploy user as owner avoids the first
# cron run failing on a write-to-/var/log permission denial.
# ---------------------------------------------------------------------------
log "INF-06 — installing cert renewal cron"
touch /var/log/vitachain-renew.log
chown "$DEPLOY_USER:$DEPLOY_USER" /var/log/vitachain-renew.log
chmod 0640 /var/log/vitachain-renew.log

cat > /etc/cron.d/vitachain-cert-renew <<EOF
# VitaChain — Let's Encrypt twice-daily renewal (INF-06).
# Generated by bootstrap-vps.sh; do not hand-edit on the VPS.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
23 0,12 * * * $DEPLOY_USER bash $PROJECT_DIR/infra/scripts/renew-cert.sh
EOF
chmod 0644 /etc/cron.d/vitachain-cert-renew

# ---------------------------------------------------------------------------
# 13) INF-07 — Nightly DB backup cron + log file + local snapshot directory
#
# 02:00 Africa/Casablanca was picked to (a) sit below Supabase's busiest-hour
# distribution and (b) stagger well away from the INF-06 cert-renew cron
# (23 0,12 * * *) — same VPS, different processes, different network targets.
# Idempotent: re-running `bootstrap-vps.sh` overwrites the cron file with
# identical content and the chown/install commands are no-ops on existing
# correctly-owned paths.
# ---------------------------------------------------------------------------
log "INF-07 — installing /etc/cron.d/vitachain-db-backup"
cat > /etc/cron.d/vitachain-db-backup <<EOF
# VitaChain — nightly pg_dump → B2 (INF-07). Managed by bootstrap-vps.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
0 2 * * * $DEPLOY_USER bash $PROJECT_DIR/infra/scripts/backup-db.sh
EOF
chmod 0644 /etc/cron.d/vitachain-db-backup

log "INF-07 — ensuring /var/log/vitachain-backup.log is owned by $DEPLOY_USER"
touch /var/log/vitachain-backup.log
chown "$DEPLOY_USER:$DEPLOY_USER" /var/log/vitachain-backup.log
chmod 0640 /var/log/vitachain-backup.log

log "INF-07 — ensuring local backup dir exists"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 /opt/vitachain/backups

# ---------------------------------------------------------------------------
# 14) Summary
# ---------------------------------------------------------------------------
echo
log "=== bootstrap complete ==="
echo "  OS:            $(. /etc/os-release && echo "$PRETTY_NAME")"
echo "  Docker:        $(docker --version)"
echo "  Compose:       $(docker compose version)"
echo "  Deploy user:   $DEPLOY_USER  ($(getent passwd "$DEPLOY_USER" | cut -d: -f6))"
echo "  Project dir:   $PROJECT_DIR  ($(stat -c '%U:%G %a' "$PROJECT_DIR"))"
echo "  Swap:          $(swapon --show=SIZE --noheadings | head -1 || echo 'none')"
echo "  Timezone:      $(timedatectl show -p Timezone --value)"
echo "  UFW:"
ufw status verbose | sed 's/^/    /'
echo
if [[ -f /var/run/reboot-required ]]; then
    warn "A reboot is required (kernel/library update). Run: reboot"
fi
echo "Log: $LOG_FILE"
echo "Next: from your workstation run ./infra/scripts/deploy.sh"
