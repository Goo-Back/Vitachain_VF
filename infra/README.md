# VitaChain — Infrastructure (INF-01)

Implements [docs/stories/INF-01-provision-vps-docker-nginx.md](../docs/stories/INF-01-provision-vps-docker-nginx.md). Everything in this folder is rsynced verbatim to `/opt/vitachain/` on the VPS.

## Layout

```
infra/
├── docker-compose.yml          # Root stack (Phase-1: only NGINX)
├── nginx/
│   ├── conf.d/default.conf     # Placeholder vhost + /healthz
│   └── html/index.html         # Static landing page
├── scripts/
│   ├── bootstrap-vps.sh        # Run once on the VPS as root
│   ├── deploy.sh               # rsync + compose up — run from workstation
│   └── verify.sh               # Automated §6 checklist
├── Makefile                    # Convenience targets
├── .env.example                # Copy → .env, fill in
└── .gitignore
```

## End-to-end runbook (from zero to acceptance criterion)

### 0. Prep on the workstation

```bash
cp infra/.env.example infra/.env
# Edit infra/.env: set VPS_HOST to the VPS IP (later swap to vitachain.ma).
make -C infra preflight        # verifies ssh/rsync/curl/dig + .env + key
```

### 1. Provision the VPS at the provider

- Ubuntu 24.04 LTS, 2–4 vCPU / 4–8 GB RAM / 40 GB SSD, EU region.
- Paste your `id_ed25519.pub` during creation.
- Store provider login, root password, IP in Bitwarden.

### 2. Bootstrap

```bash
# Variant A — Make
make -C infra bootstrap

# Variant B — manual (if your local Make can't reach the VPS as root yet)
scp infra/scripts/bootstrap-vps.sh root@<IP>:/root/
ssh root@<IP> 'bash /root/bootstrap-vps.sh "$(cat ~/.ssh/id_ed25519.pub)"'
```

After bootstrap, root SSH is disabled. Test:

```bash
ssh vitachain@<IP>
```

### 3. DNS

Add A records at the registrar (TTL **300 s** — matches PRD §8.2 demo-day RTO):

| Type | Host    | Value     |
|------|---------|-----------|
| A    | `@`     | `<VPS_IP>`|
| A    | `www`   | `<VPS_IP>`|
| A    | `api`   | `<VPS_IP>`|
| A    | `status`| `<VPS_IP>`|

Wait for propagation:

```bash
dig +short vitachain.ma
```

Then switch `infra/.env` `VPS_HOST` from the IP to `vitachain.ma`.

### 4. Deploy

```bash
make -C infra deploy
```

The script rsyncs, runs `docker compose up -d`, and waits up to 60 s for `/healthz`.

### 5. Verify

```bash
make -C infra verify
```

All 8 checks must pass. This is the acceptance gate for INF-01.

## Local smoke test (no VPS)

Before touching any cloud, validate the compose file on Docker Desktop. The
`smoke-local` target brings up **only** the NGINX service (frontend/backend
need real Supabase build args; they're tested in their own stories):

```bash
make -C infra smoke-local
curl http://localhost/healthz   # → ok
curl -I http://localhost        # → HTTP/1.1 200 OK
docker compose -p vita_smoke down
```

To sanity-check NGINX configuration changes without any container at all:

```bash
make -C infra nginx-test        # nginx -t in a throwaway nginx:alpine
```

## What this story does NOT do

| Concern | Story |
|---|---|
| HTTPS / Let's Encrypt | INF-06 |
| Backups → Backblaze B2 | INF-07 |
| Sentry + Uptime Kuma | INF-08 |
| NGINX rate limiting | AUTH-08 |
| Supabase project | INF-02 |
| Next.js / FastAPI services | INF-03 / INF-04 |

When those land, append services to `docker-compose.yml` and vhosts to `nginx/conf.d/`.
