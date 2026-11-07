#!/usr/bin/env bash
# Brings this folder and the running app up to date in one step:
#   1. git pull (fast-forward only; stops and says why if it cannot)
#   2. npm install, only when package.json or package-lock.json changed
#   3. rebuilds and restarts the Docker app (port 3737) when Docker runs it; `git pull` alone does
#      not update the Docker image
#   4. warns when a Docker Ollama holds port 11434 in front of the Ollama app
# Run: npm run update   (or double-click update-mac.command)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

before="$(git rev-parse HEAD)"
echo "[1/3] Pulling the latest code..."
if ! git pull --ff-only; then
  echo
  echo "git pull stopped. Common causes:"
  echo "  - Untracked files under tests/fixtures/recorded:"
  echo "      mv tests/fixtures/recorded ~/recorded-backup && npm run update"
  echo "  - Files you changed in this folder: see 'git status'; keep a copy, then 'git checkout -- <file>'."
  exit 1
fi
after="$(git rev-parse HEAD)"

if [ "${before}" = "${after}" ]; then
  echo "Already up to date (${after:0:7})."
else
  echo "Updated ${before:0:7} -> ${after:0:7}."
fi

echo "[2/3] Checking packages..."
if [ ! -d node_modules ] || ! git diff --quiet "${before}" "${after}" -- package.json package-lock.json; then
  npm install --no-audit --no-fund
else
  echo "Packages unchanged; npm install not needed."
fi

echo "[3/3] Checking the Docker app..."
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ -n "$(docker compose ps -a -q econquest 2>/dev/null)" ]; then
    echo "Rebuilding and restarting the Docker app (port 3737)..."
    docker compose up -d --build econquest
  else
    echo "No Docker app found for this folder; nothing to rebuild (start it with start-mac.command)."
  fi
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -E ':11434->' | grep -vq '^econquest'; then
    echo
    echo "WARNING: a Docker container holds port 11434:"
    docker ps --format '  {{.Names}} {{.Ports}}' | grep -E ':11434->' || true
    echo "  It answers in front of the Ollama app (often without your models or the GPU)."
    echo "  To use the Ollama app: docker stop <name> && open -a Ollama"
  fi
else
  echo "Docker is not running; skipped. If you use the Docker app, open Docker and run this again."
fi

echo
echo "Done. If you run 'npm run dev', restart it to load the new code."
