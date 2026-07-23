#!/usr/bin/env bash
# Run on the VPS: bash /opt/aether/deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[aether] pull…"
git fetch origin
git reset --hard origin/main

if [[ ! -f .env ]]; then
  echo "[aether] missing .env — copy .env.example and set SITE_PASSWORD"
  exit 1
fi

echo "[aether] rebuild & restart…"
docker compose up -d --build

echo "[aether] status:"
docker compose ps
curl -fsS "http://127.0.0.1:${PORT:-8787}/api/health" || true
echo
echo "[aether] done. logs: docker logs -f aether"
