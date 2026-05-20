# VitaChain — db entrypoints (INF-02)
# Loads db/.env automatically. Run from repo root: `make -C db <target>`.

SHELL := /usr/bin/env bash
ifneq (,$(wildcard ./.env))
include ./.env
export
endif

.DEFAULT_GOAL := help

.PHONY: help push verify smoke psql reset list test-auth01 test-auth02 test-auth04 test-auth06 test-auth07

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "Usage:\n  make -C db <target>\n\nTargets:\n"} \
	      /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

push:    ## Apply every migrations/*.sql in numeric order via psql
	@bash scripts/push.sh

verify:  ## Run INF-02 §6 automated verification checklist + AUTH-01/02/04/06/07 trigger suite
	@bash scripts/verify.sh
	@$(MAKE) --no-print-directory test-auth01
	@$(MAKE) --no-print-directory test-auth02
	@$(MAKE) --no-print-directory test-auth04
	@$(MAKE) --no-print-directory test-auth06
	@$(MAKE) --no-print-directory test-auth07

smoke:   ## Run §5.12 signup smoke test (positive + negative)
	@bash scripts/smoke-signup.sh

test-auth01: ## AUTH-01 — exhaustive handle_new_user() coverage (12 positive + 2 negative)
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env, service-role DIRECT :5432)" && exit 1)
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth01_trigger.sql

test-auth02: ## AUTH-02 — enum parity + JWT role hook + no-ADMIN-self-signup
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env, service-role DIRECT :5432)" && exit 1)
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth02_enum_parity.sql
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth02_jwt_role.sql
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth02_no_admin_signup.sql

test-auth04: ## AUTH-04 — RLS contract (structural) + cross-role isolation smoke
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env, service-role DIRECT :5432)" && exit 1)
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth04_rls_contract.sql
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth04_cross_role_isolation.sql

test-auth06: ## AUTH-06 — kyc_documents RLS + JWT hook + verification gate drill
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env, service-role DIRECT :5432)" && exit 1)
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth06_kyc_documents_rls.sql
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth06_jwt_verification_status_hook.sql
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth06_verification_gate_template.sql

test-auth07: ## AUTH-07 — role × table × verb matrix (22 cells) + 11 BR assertions
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env, service-role DIRECT :5432)" && exit 1)
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth07_role_matrix.sql
	psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth07_business_rules.sql

psql:    ## Open an interactive psql against $$DB_URL
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env)" && exit 1)
	psql "$$DB_URL"

list:    ## List applied migrations (uses _migrations bookkeeping table)
	@test -n "$$DB_URL" || (echo "DB_URL is required (db/.env)" && exit 1)
	psql "$$DB_URL" -c "select version, applied_at from public._migrations order by version;"

reset:   ## DANGEROUS — drop schema public and reapply. Refuses on production refs.
	@bash scripts/push.sh --reset
