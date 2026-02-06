#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing deploy/.env. Copy deploy/.env.example and set DOMAIN, EMAIL."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${DOMAIN:-}" ] || [ -z "${EMAIL:-}" ]; then
  echo "DOMAIN and EMAIL must be set in deploy/.env"
  exit 1
fi

# Render nginx config
sed "s/__DOMAIN__/${DOMAIN}/g" "$ROOT/deploy/nginx.conf.template" > "$ROOT/deploy/nginx.conf"

mkdir -p "$ROOT/deploy/certbot/www" "$ROOT/deploy/certbot/conf"

# Start nginx (http only) and app
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" up -d nginx app

# Request cert
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  --email "$EMAIL" --agree-tos --no-eff-email \
  -d "$DOMAIN"

# Reload nginx with certs
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" restart nginx

# Start renew loop
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" up -d certbot

echo "HTTPS ready: https://${DOMAIN}"
