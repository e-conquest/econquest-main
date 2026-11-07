#!/usr/bin/env bash
# ==============================================================================
# EconQuest — Sovereign Council Orchestrator
# Turnkey macOS Self-Host Launcher (Apple Silicon M1/M2/M3/M4 Metal & Intel)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

QUICK_MODEL="${OLLAMA_QUICK_MODEL:-qwen2.5:7b}"
DEEP_MODEL="${OLLAMA_DEEP_MODEL:-qwen2.5:32b}"
PORT="${PORT:-3737}"

echo "=============================================================================="
echo "  EconQuest — Sovereign Council Orchestrator (macOS Self-Host Launcher)"
echo "=============================================================================="
echo "  Architecture : $(uname -m) ($(sw_vers -productName 2>/dev/null || echo 'macOS'))"
echo "  Quick Model  : ${QUICK_MODEL} (Phase 1-2: 9 Specialist Sub-Agents)"
echo "  Deep Model   : ${DEEP_MODEL} (Phase 3: 3 Supreme Council Referees)"
echo "=============================================================================="

# 1. Verify Docker Desktop is installed and running
if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker is not installed. Install Docker Desktop for Mac: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[INFO] Starting Docker Desktop on macOS..."
  open -a Docker || true
  echo "[INFO] Waiting for Docker engine to initialize..."
  until docker info >/dev/null 2>&1; do
    sleep 2
  done
fi

# 1b. The app runs as an ordinary user (uid 1000), not root. Data saved by an older version that
#     ran as root is handed to that user once, so the app can keep writing it.
echo "[INFO] Building the app image and checking the data folder owner..."
docker compose build econquest
docker compose run --rm --no-deps --user root --entrypoint chown econquest -R 1000:1000 /app/data >/dev/null 2>&1 || true

# 2. Detect Native macOS Ollama (Apple Silicon Metal Acceleration) vs Bundled Container
if curl -sSf http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "[OK] Detected native macOS Ollama running on http://localhost:11434 (Apple Metal GPU accelerated)."
  export OLLAMA_BASE_URL="http://host.docker.internal:11434"
  if command -v ollama >/dev/null 2>&1; then
    echo "[INFO] Ensuring local models (${QUICK_MODEL} & ${DEEP_MODEL}) are pulled..."
    ollama pull "${QUICK_MODEL}" || true
    ollama pull "${DEEP_MODEL}" || true
  fi
  echo "[INFO] Launching EconQuest container connected to Host Ollama (${OLLAMA_BASE_URL})..."
  docker compose up -d --build
elif command -v ollama >/dev/null 2>&1; then
  echo "[INFO] Native macOS Ollama CLI found. Starting 'ollama serve' with OLLAMA_ORIGINS=*..."
  OLLAMA_ORIGINS="*" nohup ollama serve >/tmp/econquest-ollama.log 2>&1 &
  sleep 3
  export OLLAMA_BASE_URL="http://host.docker.internal:11434"
  ollama pull "${QUICK_MODEL}" || true
  ollama pull "${DEEP_MODEL}" || true
  echo "[INFO] Launching EconQuest container connected to Host Ollama (${OLLAMA_BASE_URL})..."
  docker compose up -d --build
else
  echo "[INFO] Native macOS Ollama not detected on host. Launching Bundled Ollama Docker profile..."
  export OLLAMA_BASE_URL="http://ollama:11434"
  docker compose --profile bundled-ollama up -d --build
fi

echo "=============================================================================="
echo "  EconQuest is live at: http://localhost:${PORT}"
echo "  Ollama Endpoint     : ${OLLAMA_BASE_URL}"
echo "=============================================================================="

if command -v open >/dev/null 2>&1; then
  sleep 2
  open "http://localhost:${PORT}" || true
fi
