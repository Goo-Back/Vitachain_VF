# INF-01 — Provision VPS + Docker + NGINX

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must
> **Status:** TODO
> **Depends on:** — (none; entry point of the dependency graph)
> **Unblocks:** INF-02, INF-04, INF-06, AUTH-08
> **Acceptance:** `curl http://vitachain.ma` returns `200`

---

## 1. Purpose

Stand up the single production VPS that will host every VitaChain service for the 8-week MVD: Docker engine, the project's container network, and an NGINX reverse-proxy fronting Next.js (`vitachain.ma`), FastAPI (`api.vitachain.ma`), and later self-hosted observability (Uptime Kuma, Sentry-lite). At end of this story a `curl` against the root domain over HTTP must return 200 from an NGINX-served placeholder.

This story sets the foundation for every other infrastructure ticket — provisioning happens **once**, so do it deliberately and document every credential in Bitwarden.

---

## 2. Scope

### In scope
- VPS rental + SSH hardening
- Base OS packages, swap, timezone, locale
- Docker Engine + Docker Compose plugin
- Non-root deploy user (`vitachain`) with Docker access
- UFW firewall (22, 80, 443 only)
- Project directory layout under `/opt/vitachain`
- Root `docker-compose.yml` skeleton with the shared bridge network `vita_net`
- NGINX reverse-proxy container serving a placeholder `index.html`
- DNS A records pointing `vitachain.ma`, `api.vitachain.ma`, `status.vitachain.ma` → VPS IP

### Out of scope (covered by later stories)
- HTTPS / Let's Encrypt → **INF-06**
- Backups → **INF-07**
- Sentry / Uptime Kuma → **INF-08**
- NGINX `limit_req_zone` rate limiting → **AUTH-08**
- Supabase project + schema → **INF-02**

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| Domain `vitachain.ma` registered | Registrar credentials in Bitwarden |
| VPS provider account | Hetzner CX22 or Contabo VPS S — ~50 MAD/month |
| SSH key pair generated locally | `ed25519`, passphrase stored in Bitwarden |
| Bitwarden shared vault | Used for all secrets created in this story |
| Team Telegram/Discord channel | Used later for alerts; just confirm it exists |

---

## 4. Target Specs

| Resource | Target | Rationale |
|---|---|---|
| vCPU | 2–4 | 50 concurrent users (PRD §8.1) |
| RAM | 4–8 GB | Postgres + FastAPI + Next.js + NGINX + workers |
| Disk | ≥ 40 GB SSD | Docker images + Postgres growth |
| OS | Ubuntu 24.04 LTS | LTS, predictable, well-documented |
| Region | EU (Frankfurt/Nuremberg) | Closest low-cost region to Morocco |
| IPv4 | Static, public | Required for DNS A records |

---

## 5. Step-by-Step Implementation

### 5.1 Provision the VPS

1. Order the VPS with Ubuntu 24.04, paste your SSH **public** key during creation.
2. Record in Bitwarden: provider, IP, root password (rescue), SSH key fingerprint.
3. First login as `root`:
   ```bash
   ssh root@<VPS_IP>
   ```

### 5.2 Base hardening

```bash
# Update + essentials
apt update && apt -y upgrade
apt -y install ufw fail2ban unattended-upgrades curl ca-certificates gnupg \
               htop tmux git vim

# Timezone + locale
timedatectl set-timezone Africa/Casablanca
locale-gen en_US.UTF-8

# 2 GB swap (cheap insurance on 4 GB plans)
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 5.3 Create the deploy user

```bash
adduser --disabled-password --gecos "" vitachain
usermod -aG sudo vitachain
mkdir -p /home/vitachain/.ssh
cp /root/.ssh/authorized_keys /home/vitachain/.ssh/
chown -R vitachain:vitachain /home/vitachain/.ssh
chmod 700 /home/vitachain/.ssh
chmod 600 /home/vitachain/.ssh/authorized_keys
```

Disable root login + password auth in [/etc/ssh/sshd_config](/etc/ssh/sshd_config):

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
systemctl restart ssh
```

Open a **second terminal** and verify `ssh vitachain@<VPS_IP>` works before closing the root session.

### 5.4 Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

### 5.5 Install Docker

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list

apt update
apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker vitachain
systemctl enable --now docker
docker --version && docker compose version
```

Log out and back in as `vitachain` so the group takes effect.

### 5.6 Project layout

As `vitachain`:

```bash
sudo mkdir -p /opt/vitachain && sudo chown vitachain:vitachain /opt/vitachain
cd /opt/vitachain
mkdir -p nginx/conf.d nginx/html
```

### 5.7 Root `docker-compose.yml`

[/opt/vitachain/docker-compose.yml](/opt/vitachain/docker-compose.yml):

```yaml
name: vitachain

networks:
  vita_net:
    driver: bridge

services:
  nginx:
    image: nginx:1.27-alpine
    container_name: vita_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      # 443 will be wired up by INF-06 (Let's Encrypt)
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/html:/usr/share/nginx/html:ro
    networks:
      - vita_net
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### 5.8 NGINX placeholder config

[/opt/vitachain/nginx/conf.d/default.conf](/opt/vitachain/nginx/conf.d/default.conf):

```nginx
# Placeholder server — replaced by Next.js / FastAPI upstreams in INF-03 / INF-04.
server {
    listen 80 default_server;
    server_name vitachain.ma www.vitachain.ma _;

    # Health endpoint used by docker healthcheck + Uptime Kuma (INF-08).
    location = /healthz {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

[/opt/vitachain/nginx/html/index.html](/opt/vitachain/nginx/html/index.html):

```html
<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"><title>VitaChain — provisioning</title></head>
  <body style="font-family:system-ui;padding:2rem">
    <h1>VitaChain</h1>
    <p>Infrastructure online. Application services landing soon.</p>
  </body>
</html>
```

### 5.9 Bring it up

```bash
cd /opt/vitachain
docker compose up -d
docker compose ps
curl -I http://localhost
```

### 5.10 DNS

In the registrar control panel, create:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | `<VPS_IP>` | 300 |
| A | `www` | `<VPS_IP>` | 300 |
| A | `api` | `<VPS_IP>` | 300 |
| A | `status` | `<VPS_IP>` | 300 |

300 s TTL aligns with the PRD §8.2 demo-day RTO target (< 30 min after DNS swing).

Wait for propagation (`dig +short vitachain.ma`) then validate from your laptop:

```bash
curl -i http://vitachain.ma
```

---

## 6. Verification Checklist

- [ ] `ssh vitachain@vitachain.ma` works; `ssh root@…` is refused
- [ ] `ufw status` shows only 22/80/443
- [ ] `docker compose ps` shows `vita_nginx` `Up (healthy)`
- [ ] `curl -o /dev/null -s -w "%{http_code}\n" http://vitachain.ma` → `200`
- [ ] `curl http://vitachain.ma/healthz` → `ok`
- [ ] `dig +short vitachain.ma` returns the VPS IP
- [ ] All credentials (VPS root password, deploy SSH key passphrase, registrar login) stored in shared Bitwarden vault
- [ ] `/opt/vitachain` owned by `vitachain:vitachain`, `chmod 750`

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| `docker-compose.yml` | `/opt/vitachain/docker-compose.yml` |
| NGINX config | `/opt/vitachain/nginx/conf.d/default.conf` |
| Placeholder HTML | `/opt/vitachain/nginx/html/index.html` |
| Runbook entry | Add a section "VPS bootstrap" to `docs/runbook.md` (create if missing) |
| Bitwarden entries | `VitaChain — VPS root`, `VitaChain — vitachain user`, `VitaChain — registrar` |
| `spring-status.yml` update | Flip `INF-01.status` → `DONE`, bump `summary.done` |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| VPS single point of failure | Snapshot weekly + document a 30-min restore drill | PRD §13 R1 |
| Brute-force on SSH/HTTP | UFW + fail2ban now; NGINX `limit_req_zone` in AUTH-08 | PRD §13 R6 |
| NGINX/Docker misconfiguration | Time-box this story to 1 day; fallback = Vercel monolith | PRD §13 R4 |
| Locked out by SSH hardening | Always validate new SSH session in a second terminal before closing the first | — |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Order VPS + DNS | 30 min |
| Base hardening + user + UFW | 45 min |
| Docker install + smoke test | 30 min |
| Compose + NGINX placeholder | 45 min |
| DNS propagation + end-to-end curl | 30 min (wall clock, not active) |
| **Total active work** | **~2.5 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: `curl http://vitachain.ma` returns `200`.
2. Verification checklist (§6) fully ticked.
3. Deliverables (§7) committed or stored in Bitwarden.
4. `docs/spring-status.yml` updated and committed.
5. Hand-off note posted to the team channel naming the next two stories unblocked: **INF-02** (Supabase) and **INF-04** (FastAPI scaffold).
