#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" run --rm certbot \
  renew --webroot -w /var/www/certbot

/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" restart nginx
