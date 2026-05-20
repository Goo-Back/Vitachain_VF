# VitaChain — top-level entrypoints (INF-05).
# The per-tree Makefiles (backend/, db/, infra/) remain the canonical command
# surfaces; these targets just fan out for the CI-local + hooks workflow.
#
# On pure Windows PowerShell, run the underlying commands directly — the
# Makefile assumes Git-Bash / WSL / Linux / macOS like every other tree.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help \
        hooks-install hooks-run hooks-update \
        secrets-check ci-local \
        backend-ci frontend-ci infra-ci \
        auth07

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "Targets:\n"} \
	      /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# -- Hooks --------------------------------------------------------------------

hooks-install:  ## One-time: install pre-commit + pre-push hooks
	@command -v pre-commit >/dev/null 2>&1 || { \
	    echo "installing pre-commit (via pipx, falling back to pip --user)"; \
	    pipx install pre-commit 2>/dev/null || pip install --user pre-commit; \
	}
	pre-commit install
	pre-commit install --hook-type pre-push
	@echo "  ✓ .git/hooks/{pre-commit,pre-push} installed"

hooks-run:  ## Run every pre-commit hook against the whole tree
	pre-commit run --all-files

hooks-update:  ## Bump pinned hook revs (review the diff carefully)
	pre-commit autoupdate

# -- Secret-leak boundary -----------------------------------------------------

secrets-check:  ## Run only the AUTH-05 boundary script
	@bash scripts/check-secrets-boundary.sh

# -- CI locally ---------------------------------------------------------------

ci-local: secrets-check backend-ci frontend-ci infra-ci  ## Run every CI check locally, in CI order
	@echo ""
	@echo "  \033[1;32m✓\033[0m ci-local — all green"

backend-ci:  ## CI 'backend' job, locally
	@echo "==> backend"
	@$(MAKE) -C backend lint
	@$(MAKE) -C backend test

frontend-ci:  ## CI 'frontend' job, locally (skips docker build)
	@echo "==> frontend"
	@cd frontend && npm run lint && npm run typecheck && npm run build

infra-ci:  ## CI 'infra' job, locally (shellcheck + nginx -t)
	@echo "==> infra"
	@command -v shellcheck >/dev/null 2>&1 || { echo "  ! shellcheck not installed — skipping"; exit 0; }
	shellcheck infra/scripts/*.sh db/scripts/*.sh scripts/*.sh
	@$(MAKE) -C infra nginx-test

# -- AUTH-07 ------------------------------------------------------------------

auth07:  ## AUTH-07 — RLS matrix + BR DB suite + (optional) staging e2e
	@bash scripts/verify-rls-matrix.sh
