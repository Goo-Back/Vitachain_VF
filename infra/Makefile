# VitaChain — infra entrypoints (INF-01)
# Loads infra/.env automatically. Run from repo root: `make -C infra <target>`.

SHELL := /usr/bin/env bash
ifneq (,$(wildcard ./.env))
include ./.env
export
endif

.DEFAULT_GOAL := help

.PHONY: help preflight nginx-test bootstrap deploy verify logs ps down smoke-local \
        frontend-build frontend-logs frontend-rebuild \
        backend-build backend-logs backend-rebuild \
        issue-cert issue-cert-prod renew-cert renew-cert-dryrun cert-info cert-delete \
        backup-rclone-config backup-now backup-list backup-restore backup-logs backup-prune-local \
        observability-up observability-htpasswd observability-seed-htpasswd \
        sentry-test-backend sentry-test-frontend uptime-logs uptime-export uptime-import \
        bench-rate-limits bench-rate-limits-dryrun rate-limit-tail rate-limit-reload

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "Usage:\n  make -C infra <target>\n\nTargets:\n"} \
	      /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

preflight: ## Check workstation prerequisites before bootstrap/deploy
	@bash scripts/preflight.sh

nginx-test: ## Validate nginx/conf.d/*.conf locally (throwaway container)
	@# AUTH-08: render the rate-limit template with placeholder values so
	@# `nginx -t` sees a complete http {} scope. We use 127.0.0.1 for the
	@# VPS IP and an empty extra-whitelist; the produced file is throwaway.
	@docker run --rm \
	    -e VPS_PUBLIC_IP=127.0.0.1 \
	    -e RATELIMIT_WHITELIST_IPS_NGINX_LINES= \
	    -e NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates \
	    -e NGINX_ENVSUBST_TEMPLATE_SUFFIX=.template \
	    -e NGINX_ENVSUBST_OUTPUT_DIR=/tmp/rendered \
	    -v $$PWD/nginx/conf.d:/etc/nginx/conf.d \
	    -v $$PWD/nginx/templates:/etc/nginx/templates:ro \
	    -v $$PWD/nginx/snippets:/etc/nginx/snippets:ro \
	    -v $$PWD/nginx/html:/usr/share/nginx/html:ro \
	    nginx:1.27-alpine sh -c 'mkdir -p /tmp/rendered \
	        && /docker-entrypoint.d/20-envsubst-on-templates.sh \
	        && cp /tmp/rendered/*.conf /etc/nginx/conf.d/ \
	        && nginx -t'

bootstrap:  ## Copy + run bootstrap-vps.sh on a fresh VPS (uses VPS_HOST as root)
	@test -n "$$VPS_HOST" || (echo "VPS_HOST is required" && exit 1)
	scp scripts/bootstrap-vps.sh root@$$VPS_HOST:/root/
	@# Note: we read the deploy user's key from root's authorized_keys on the
	@# VPS — that's where the provider injected the key supplied at order time.
	ssh root@$$VPS_HOST 'bash /root/bootstrap-vps.sh "$$(cat ~/.ssh/authorized_keys | head -1)"'

deploy:    ## rsync infra/ to VPS and docker compose up -d
	@bash scripts/deploy.sh

verify:    ## Run §6 verification checklist
	@bash scripts/verify.sh

logs:      ## Tail nginx logs on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose logs -f --tail=100 nginx"

ps:        ## docker compose ps on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose ps"

down:      ## Stop the stack on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose down"

smoke-local:  ## Run the NGINX-only stack on this workstation — http://localhost
	@# Brings up ONLY the nginx service (frontend/backend need real Supabase
	@# values to build). Validates INF-01 acceptance criterion on Docker
	@# Desktop without touching a real VPS.
	docker compose -p vita_smoke -f docker-compose.yml up -d nginx
	@echo
	@echo "  curl http://localhost/healthz   → ok"
	@echo "  curl -I http://localhost        → 200"
	@echo "  Stop: docker compose -p vita_smoke down"

# --- INF-03 helpers ---------------------------------------------------------

frontend-build:  ## Build the frontend image on the VPS (no restart)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose build frontend"

frontend-logs:   ## Tail Next.js logs on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose logs -f --tail=200 frontend"

frontend-rebuild: ## Force rebuild + recreate the frontend container
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose build --no-cache frontend && docker compose up -d --force-recreate frontend"

# --- INF-04 helpers ---------------------------------------------------------

backend-build:    ## Build the backend image on the VPS (no restart)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose build backend"

backend-logs:     ## Tail FastAPI logs on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose logs -f --tail=200 backend"

backend-rebuild:  ## Force rebuild + recreate the backend container
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose build --no-cache backend && docker compose up -d --force-recreate backend"

# --- INF-06 helpers ---------------------------------------------------------

issue-cert:        ## Issue cert (STAGING — safe default). Re-run is idempotent.
	@test -n "$$VPS_HOST" || (echo "VPS_HOST is required" && exit 1)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && bash infra/scripts/issue-cert.sh"

issue-cert-prod:   ## Issue cert against PRODUCTION endpoint (rate-limited!)
	@test -n "$$VPS_HOST" || (echo "VPS_HOST is required" && exit 1)
	@echo "==> About to hit Let's Encrypt PRODUCTION — type YES when prompted."
	ssh -t $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && LETSENCRYPT_PROD=1 bash infra/scripts/issue-cert.sh"

renew-cert:        ## Force a renewal now (cron also runs twice daily)
	ssh $$VPS_USER@$$VPS_HOST "bash $$PROJECT_DIR/infra/scripts/renew-cert.sh && tail -20 /var/log/vitachain-renew.log"

renew-cert-dryrun: ## Simulate renewal without touching Let's Encrypt
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot renew --dry-run"

cert-info:         ## Show cert subject, issuer, notBefore/notAfter
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot certificates"

cert-delete:       ## DANGER — delete the cert (e.g. staging→prod swap). PRIMARY=domain
	@test -n "$$PRIMARY" || (echo "Usage: make -C infra cert-delete PRIMARY=vitachain.ma" && exit 1)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot delete --cert-name $$PRIMARY --non-interactive"

# --- INF-07 helpers ---------------------------------------------------------

backup-rclone-config:  ## ONE-SHOT — interactive rclone config for the B2 remote
	@echo "==> Walk through 'rclone config' to create a B2 remote named 'b2'."
	@echo "    When prompted: type 'n' -> name=b2 -> storage=b2 (Backblaze B2)"
	@echo "    -> account_id=<B2_ACCOUNT_ID> -> application_key=<B2_APPLICATION_KEY>"
	@echo "    -> hard_delete=true -> y/quit. Config persists in rclone_config volume."
	ssh -t $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose -f infra/docker-compose.yml run --rm --entrypoint sh db-backup -c 'rclone config --config /config/rclone/rclone.conf'"

backup-now:        ## Force a backup run now (cron also runs nightly at 02:00)
	ssh $$VPS_USER@$$VPS_HOST "bash $$PROJECT_DIR/infra/scripts/backup-db.sh && tail -30 /var/log/vitachain-backup.log"

backup-list:       ## List recent backups (last 10 local + last 10 on B2)
	@echo "==> Local (/opt/vitachain/backups):"
	ssh $$VPS_USER@$$VPS_HOST "ls -lh /opt/vitachain/backups/ 2>/dev/null | grep vitachain_db_ | tail -10"
	@echo "==> Remote (b2:$${BACKUP_BUCKET:-vitachain-backups}/$${BACKUP_REMOTE_PATH:-postgres}):"
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose -f infra/docker-compose.yml run --rm --entrypoint rclone db-backup --config /config/rclone/rclone.conf lsl b2:$${BACKUP_BUCKET:-vitachain-backups}/$${BACKUP_REMOTE_PATH:-postgres}/ | sort | tail -10"

backup-restore:    ## DRILL — restore <BACKUP_FILE> into <STAGING_DB_URL>
	@test -n "$$BACKUP_FILE"     || (echo "Usage: make backup-restore BACKUP_FILE=... STAGING_DB_URL=..." && exit 1)
	@test -n "$$STAGING_DB_URL"  || (echo "Usage: make backup-restore BACKUP_FILE=... STAGING_DB_URL=..." && exit 1)
	ssh -t $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && STAGING_DB_URL='$$STAGING_DB_URL' bash infra/scripts/restore-db.sh '$$BACKUP_FILE' '$$STAGING_DB_URL'"

backup-logs:       ## Tail the backup log on the VPS
	ssh $$VPS_USER@$$VPS_HOST "tail -100 /var/log/vitachain-backup.log"

backup-prune-local: ## Manual local prune — rare, for filling-disk debugging
	ssh $$VPS_USER@$$VPS_HOST "find /opt/vitachain/backups/ -name 'vitachain_db_*' -mtime +$${BACKUP_RETENTION_LOCAL_DAYS:-7} -print -delete"

# --- INF-08 helpers ---------------------------------------------------------

observability-up:        ## Bring up the Uptime Kuma container (idempotent)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose up -d uptime_kuma"

observability-htpasswd:  ## Print a bcrypt htpasswd line. USER=... PASS=...
	@test -n "$$USER" || (echo "Usage: make -C infra observability-htpasswd USER=admin PASS='...'" && exit 1)
	@test -n "$$PASS" || (echo "Usage: make -C infra observability-htpasswd USER=admin PASS='...'" && exit 1)
	@# Run htpasswd inside a throwaway httpd:alpine container so we don't
	@# depend on apache2-utils being installed on the developer laptop.
	docker run --rm httpd:2.4-alpine htpasswd -nbB "$$USER" "$$PASS"

observability-seed-htpasswd: ## Seed /uptime/ htpasswd into the named volume from UPTIME_KUMA_ADMIN_*
	@test -n "$$UPTIME_KUMA_ADMIN_USER"          || (echo "UPTIME_KUMA_ADMIN_USER unset"          && exit 1)
	@test -n "$$UPTIME_KUMA_ADMIN_PASSWORD_HASH" || (echo "UPTIME_KUMA_ADMIN_PASSWORD_HASH unset" && exit 1)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && \
	    docker compose run --rm --entrypoint sh nginx -c \
	        \"mkdir -p /etc/nginx/htpasswd && \
	          printf '%s:%s\n' '$$UPTIME_KUMA_ADMIN_USER' '$$UPTIME_KUMA_ADMIN_PASSWORD_HASH' \
	            > /etc/nginx/htpasswd/uptime.htpasswd\" && \
	    docker compose exec nginx nginx -s reload"

sentry-test-backend:     ## Curl the planted backend route. REFUSES against prod VPS_HOST.
	@case "$$VPS_HOST" in vitachain.ma|www.vitachain.ma) \
	    echo "Refusing — looks like prod ($$VPS_HOST)"; exit 1 ;; esac
	@echo "==> Hitting https://$$VPS_HOST/api/v1/_sentry_test (expect 500 in staging)"
	curl -k -sS -o /dev/null -w "%{http_code}\n" "https://$$VPS_HOST/api/v1/_sentry_test"

sentry-test-frontend:    ## Print the staging URL for the planted frontend page
	@case "$$VPS_HOST" in vitachain.ma|www.vitachain.ma) \
	    echo "Refusing — looks like prod ($$VPS_HOST)"; exit 1 ;; esac
	@echo "Open this URL in a browser, then click 'Throw':"
	@echo "  https://$$VPS_HOST/__sentry-test"

uptime-logs:             ## Tail Uptime Kuma logs on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose logs -f --tail=200 uptime_kuma"

uptime-export:           ## Dump Kuma config + history JSON to infra/backups/uptime_kuma_<UTC>.json
	@mkdir -p backups
	@out="backups/uptime_kuma_$$(date -u +%Y%m%d_%H%M%SZ).json"; \
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && \
	    docker compose exec -T uptime_kuma sh -c 'curl -fsS http://127.0.0.1:3001/api/backup'" > "$$out"; \
	ls -lh "$$out"

# --- AUTH-08 helpers --------------------------------------------------------

bench-rate-limits:        ## AUTH-08 — fire the 8 calibration scenarios against $VPS_HOST
	@test -n "$$VPS_HOST" || (echo "VPS_HOST required (infra/.env)" && exit 1)
	@bash scripts/bench-rate-limits.sh

bench-rate-limits-dryrun: ## AUTH-08 — print the `hey` invocations without firing them
	@test -n "$$VPS_HOST" || (echo "VPS_HOST required (infra/.env)" && exit 1)
	@DRYRUN=1 bash scripts/bench-rate-limits.sh

rate-limit-tail:          ## AUTH-08 — tail NGINX error.log for `limiting requests` lines
	@test -n "$$VPS_HOST" || (echo "VPS_HOST required (infra/.env)" && exit 1)
	ssh "$$VPS_USER@$$VPS_HOST" 'docker exec vita_nginx sh -c "tail -F /var/log/nginx/error.log" | grep --line-buffered "limiting requests"'

rate-limit-reload:        ## AUTH-08 — graceful NGINX reload after editing rate-limit config
	@test -n "$$VPS_HOST" || (echo "VPS_HOST required (infra/.env)" && exit 1)
	ssh "$$VPS_USER@$$VPS_HOST" 'docker exec vita_nginx nginx -t && docker exec vita_nginx nginx -s reload && echo "reloaded"'

uptime-import:           ## Restore newest export — requires interactive YES confirm
	@latest=$$(ls -t backups/uptime_kuma_*.json 2>/dev/null | head -1); \
	test -n "$$latest" || (echo "No exports under infra/backups/"; exit 1); \
	echo "About to POST $$latest back to Kuma — type YES to confirm:"; \
	read confirm; [ "$$confirm" = "YES" ] || (echo "aborted"; exit 1); \
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && \
	    docker compose exec -T uptime_kuma sh -c \
	        \"curl -fsS -X POST http://127.0.0.1:3001/api/restore -H 'Content-Type: application/json' --data @-\"" \
	    < "$$latest"
