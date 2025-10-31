#!/usr/bin/env bash
set -euo pipefail

BRANCH="samir.pages.dev"
REMOTE="origin"
HUGO_TOML="hugo.toml"

# URLs to swap in hugo.toml
FROM_URL='baseURL = "https://samirpaulb.github.io/"'
TO_URL='baseURL = "https://samir.pages.dev/"'

# 1) Ensure up-to-date remote refs
git fetch "$REMOTE"

# 2) Switch to target branch
git switch "$BRANCH"

# 3) Reset branch to match origin/main exactly (discard local changes)
git reset --hard "${REMOTE}/main"

# 4) Update baseURL in hugo.toml in place
if grep -q '^baseURL\s*=\s*"https://samirpaulb.github.io/"' "$HUGO_TOML"; then
  sed -i 's|^baseURL\s*=\s*"https://samirpaulb.github.io/"|baseURL = "https://samir.pages.dev/"|' "$HUGO_TOML"
else
  printf '\nbaseURL = "https://samir.pages.dev/"\n' >> "$HUGO_TOML"
fi

# 5) Commit the config change if there is one
if ! git diff --quiet; then
  git add "$HUGO_TOML"
  git commit -m "chore: set Hugo baseURL to https://samir.pages.dev/"
fi

# 6) Push with safety
git push --force-with-lease "$REMOTE" "$BRANCH"

# 7) Return to main
git switch main
# or to return to the previously checked-out branch regardless of name:
# git switch -
