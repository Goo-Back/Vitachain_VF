# INF-07 — db-backup sidecar. postgres-client 17 + rclone + bash + coreutils.
# Pinned by digest in infra/docker-compose.yml.
#
# Why a custom image, not two separate sidecars (postgres + rclone)?
#   - One image = one ENTRYPOINT = one `set -euo pipefail` boundary; a failed
#     gzip is observable to the same caller that ran pg_dump.
#   - Compose volume sharing between two run-once services is workable but adds
#     a second `docker compose run` that has to be sequenced and error-handled
#     by hand. One container is plainer.
#   - The combined image is < 80 MB compressed — well within the budget.

FROM postgres:17-alpine

# rclone is in the alpine-edge community repo; we install via the official
# binary archive pinned to a known version to avoid alpine-edge drift.
ARG RCLONE_VERSION=v1.68.2
RUN apk add --no-cache bash coreutils ca-certificates curl gzip unzip findutils \
 && curl -fsSL "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" -o /tmp/rclone.zip \
 && unzip /tmp/rclone.zip -d /tmp/ \
 && install -m 0755 "/tmp/rclone-${RCLONE_VERSION}-linux-amd64/rclone" /usr/local/bin/rclone \
 && rm -rf /tmp/rclone.zip "/tmp/rclone-${RCLONE_VERSION}-linux-amd64" \
 && rclone --version

# The entrypoint script is bind-mounted by compose (not COPYd) so that operator
# edits don't require an image rebuild. The image's job is to ship the binaries
# (pg_dump, rclone, sha256sum, gzip); the orchestration lives outside.
WORKDIR /backups
ENTRYPOINT ["bash", "/usr/local/bin/backup-entrypoint.sh"]
