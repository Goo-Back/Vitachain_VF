# VitaChain backend — Makefile (Git-Bash / WSL / Linux / macOS).
# On pure-Windows PowerShell, run the underlying commands directly.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

VENV       ?= .venv
ACT        := . $(VENV)/Scripts/activate 2>/dev/null || . $(VENV)/bin/activate
IMAGE      ?= vitachain/backend:dev
PORT       ?= 8000

.PHONY: help install lock dev lint format test docker-build docker-run docker-stop smoke clean

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "Targets:\n"} \
	      /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

$(VENV)/pyvenv.cfg:
	python -m venv $(VENV)

install: $(VENV)/pyvenv.cfg  ## Create venv and install pinned (or unpinned) deps
	@$(ACT) && pip install --upgrade pip pip-tools
	@if [ -f requirements.lock.txt ]; then \
	    $(ACT) && pip install -r requirements.lock.txt ; \
	else \
	    $(ACT) && pip install -r requirements.in ; \
	fi
	@$(ACT) && pip install ruff

lock: $(VENV)/pyvenv.cfg  ## Recompile requirements.lock.txt from requirements.in
	@$(ACT) && pip install --upgrade pip-tools
	@$(ACT) && pip-compile --output-file=requirements.lock.txt requirements.in

dev:  ## Hot-reload uvicorn on :$(PORT)
	@$(ACT) && uvicorn app.main:app --reload --port $(PORT)

lint:  ## Ruff lint
	@$(ACT) && ruff check app tests

format:  ## Ruff format
	@$(ACT) && ruff format app tests

test:  ## pytest
	@$(ACT) && pytest

docker-build:  ## Build the production image
	docker build -t $(IMAGE) .

docker-run:  ## Run the image locally on :$(PORT) with $(PWD)/.env
	docker run --rm -d --name vita_backend_dev -p $(PORT):8000 --env-file .env $(IMAGE)
	@echo "running. Smoke: curl http://localhost:$(PORT)/api/v1/healthz"

docker-stop:  ## Stop the local docker-run container
	-docker stop vita_backend_dev

smoke:  ## curl the four health endpoints (against $(PORT))
	@curl -fsS http://127.0.0.1:$(PORT)/api/v1/healthz   && echo
	@curl -fsS http://127.0.0.1:$(PORT)/api/v1/version   && echo
	@curl -fsS http://127.0.0.1:$(PORT)/api/v1/katara/healthz && echo
	@curl -fsS http://127.0.0.1:$(PORT)/api/v1/readyz    && echo

clean:  ## Remove caches + venv
	rm -rf $(VENV) .pytest_cache .ruff_cache **/__pycache__ app/__pycache__
