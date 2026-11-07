#!/usr/bin/env bash
# Double-click in Finder: pulls the latest code, installs packages when needed, rebuilds the Docker app.
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "${DIR}/scripts/update.sh"
echo
read -r -p "Press Return to close this window." _ || true
