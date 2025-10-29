```bash
# Clone
git clone git@github.com:SamirPaulb/SamirPaulb.github.io.git

# branch = main -> GitHub Pages
# Branch = samir.pages.dev -> Cloudflare Pages 
git checkout main

# from the repo root
set -euo pipefail

# 1) Remove submodules cleanly from index and working tree
git rm -f themes/DoIt || true
git rm -f content || true

# 2) Remove leftover module metadata
rm -rf .git/modules/themes/DoIt || true
rm -rf .git/modules/content || true

# 3) Ensure .gitmodules does not contain stale sections
git config -f .gitmodules --remove-section submodule.themes/DoIt || true
git config -f .gitmodules --remove-section submodule.content || true

# 4) Commit the removal (submodule pointers and .gitmodules changes)
git add -A
git commit -m "Remove stale submodules DoIt and content" || true

# 5) Re-add submodules with correct literal URLs
git submodule add https://github.com/SamirPaulb/DoIt.git themes/DoIt
git submodule add git@github.com:SamirPaulb/content.git content

# 6) Sync submodule URLs into .git/config and materialize working trees
git submodule sync --recursive
git submodule update --init --recursive

# 7) Optionally advance to latest tracked branches (if you intend to follow branches)
# git submodule update --remote --recursive

# 8) Commit the new submodule pointers and .gitmodules
git add -A
git commit -m "Re-add DoIt and content submodules with correct URLs"

```

- Hugo Theme: https://github.com/SamirPaulb/DoIt
- Content: https://github.com/SamirPaulb/content