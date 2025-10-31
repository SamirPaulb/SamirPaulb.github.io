#!/usr/bin/env bash
set -euo pipefail

BRANCH="samir.pages.dev"
REMOTE="origin"

# Files and replacements
FILES=(
  "hugo.toml"
  "static/robots.txt"
)
FROM="samirpaulb.github.io"
TO="samir.pages.dev"

# 1) Ensure up-to-date remote refs
git fetch "$REMOTE"

# 2) Switch to target branch
git switch "$BRANCH"

# 3) Reset branch to match origin/main exactly (discard local changes)
git reset --hard "${REMOTE}/main"

# 4) Replace domains in listed files (in-place)
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    # Replace all occurrences safely using a non-slash delimiter
    sed -i "s|${FROM}|${TO}|g" "$f"
  fi
done

# 5) Stage and commit only if there are changes
if ! git diff --quiet; then
  git add "${FILES[@]}"
  git commit -m "chore: replace ${FROM} with ${TO} in listed files"
fi

# 6) Push with safety
git push --force-with-lease "$REMOTE" "$BRANCH"

# 7) Return to main (or previous branch with: git switch -)
git switch main
