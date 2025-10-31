#!/usr/bin/env bash
set -euo pipefail

# Branches/remotes
BRANCH="samir.pages.dev"
REMOTE="origin"

# Files to update (add more paths as needed)
FILES=(
  "hugo.toml"
  "static/robots.txt"
)

# Replacement values
FROM="samirpaulb.github.io"
TO="samir.pages.dev"

# 1) Ensure up-to-date remote refs
git fetch "$REMOTE"

# 2) Switch to target branch
git switch "$BRANCH"

# 3) Reset branch to match origin/main exactly (discard local changes)
git reset --hard "${REMOTE}/main"

# 4) Replace domains in listed files (in-place)
changed=0
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    # Only run sed if the FROM string exists to avoid dirtying timestamps unnecessarily
    if grep -q "${FROM}" "$f"; then
      sed -i "s|${FROM}|${TO}|g" "$f"
      changed=1
    fi
  fi
done

# 5) Stage and commit only if there are changes
if [[ "$changed" -eq 1 ]] && ! git diff --quiet; then
  git add "${FILES[@]}"
  git commit -m "chore: replace ${FROM} with ${TO} in configured files"
fi

# 6) Push with safety
git push --force-with-lease "$REMOTE" "$BRANCH"

# 7) Return to main (or use `git switch -` to go back to previous branch)
git switch main
