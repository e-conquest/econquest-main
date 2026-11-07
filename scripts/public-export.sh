#!/usr/bin/env bash
# Builds the public copy of this repository: the committed tree at HEAD, minus the paths in
# scripts/public-exclude.txt, as a new git repository with ONE commit and no earlier history.
# It never pushes. Review the result, then push it yourself to the public repository.
#
#   bash scripts/public-export.sh <output folder> [--draft]
#
# Without --draft it refuses to run while TO FILL placeholders remain in the community files.
# Commit author: PUBLIC_GIT_NAME / PUBLIC_GIT_EMAIL (use a GitHub noreply address).
set -euo pipefail

out="${1:-}"
draft="${2:-}"
if [[ -z "$out" ]]; then echo "usage: bash scripts/public-export.sh <output folder> [--draft]" >&2; exit 2; fi
if [[ -e "$out" ]]; then echo "refusing: $out already exists" >&2; exit 2; fi

root="$(git rev-parse --show-toplevel)"
cd "$root"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "refusing: commit or stash your changes first (the export uses HEAD)" >&2; exit 2
fi

placeholders=$(grep -ln "TO FILL" GOVERNANCE.md CITATION.cff CHANGELOG.md 2>/dev/null || true)
if [[ -n "$placeholders" && "$draft" != "--draft" ]]; then
  echo "refusing: fill the TO FILL placeholders first in:" >&2; echo "$placeholders" >&2; exit 1
fi

mkdir -p "$out"
git archive --format=tar HEAD | tar -x -C "$out"

while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue
  rm -rf "${out:?}/$line"
  printf '\n%s/\n' "$line" >> "$out/.gitignore"
  echo "left out: $line"
done < scripts/public-exclude.txt

# Last check for anything that looks like a key. A match stops the export.
if grep -rIlE 'AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,}' "$out" --exclude-dir=node_modules; then
  echo "refusing: the files above look like they contain a key" >&2; exit 1
fi
for f in .env data/local/settings.json data/local/auth/accounts.json; do
  if [[ -e "$out/$f" ]]; then echo "refusing: $f is in the tree" >&2; exit 1; fi
done

cd "$out"
git init -q -b main
git add -A
name="${PUBLIC_GIT_NAME:-EconQuest Terminal}"
email="${PUBLIC_GIT_EMAIL:-noreply@users.noreply.github.com}"
GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
  git commit -q -s -m "EconQuest Terminal: first public release"
echo
echo "Public copy ready in $out ($(git ls-files | wc -l | xargs) files, one commit)."
echo "Next: run a full secret scan (for example gitleaks detect) in it, review, then push it to the public repository."
