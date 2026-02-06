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

if [ -z "${TURN_PUBLIC_IP:-}" ] || [ -z "${TURN_USER:-}" ] || [ -z "${TURN_PASS:-}" ]; then
  echo "TURN_PUBLIC_IP, TURN_USER, TURN_PASS must be set in deploy/.env"
  exit 1
fi

TURN_REALM="${TURN_REALM:-$DOMAIN}"
TURN_URL="turn:${TURN_PUBLIC_IP}:3478?transport=udp"
export TURN_URL TURN_USER TURN_PASS

# Render nginx http-only config first (no certs)
sed "s/__DOMAIN__/${DOMAIN}/g" "$ROOT/deploy/nginx.http.conf.template" > "$ROOT/deploy/nginx.conf"

# Render turnserver config
sed -e "s/__TURN_USER__/${TURN_USER}/g" \
    -e "s/__TURN_PASS__/${TURN_PASS}/g" \
    -e "s/__TURN_REALM__/${TURN_REALM}/g" \
    -e "s/__TURN_PUBLIC_IP__/${TURN_PUBLIC_IP}/g" \
    "$ROOT/deploy/turnserver.conf.template" > "$ROOT/deploy/turnserver.conf"

mkdir -p "$ROOT/deploy/certbot/www" "$ROOT/deploy/certbot/conf"

# Start nginx (http only) and app
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" up -d nginx app

# Request cert
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" run --rm \
  --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  --email "$EMAIL" --agree-tos --no-eff-email \
  -d "$DOMAIN"

# Render nginx https config and reload
sed "s/__DOMAIN__/${DOMAIN}/g" "$ROOT/deploy/nginx.conf.template" > "$ROOT/deploy/nginx.conf"
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" restart nginx

# Start renew loop
/usr/bin/env docker compose -f "$ROOT/deploy/docker-compose.nginx.yml" up -d certbot

echo "HTTPS ready: https://${DOMAIN}"
