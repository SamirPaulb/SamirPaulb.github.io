```bash
# Clone
git clone git@github.com:SamirPaulb/SamirPaulb.github.io.git

# branch = main -> GitHub Pages
# Branch = samir.pages.dev -> Cloudflare Pages 
git checkout main

# Remove existing working trees (if present)
rm -rf content themes/DoIt

# Clean stale submodule config entries (if any)
git config -f .gitmodules --remove-section submodule.themes/DoIt || true
git config -f .gitmodules --remove-section submodule.content || true

# Re-add submodules with correct URLs
# Public theme via HTTPS (no auth needed)
git submodule add https://github.com/SamirPaulb/DoIt.git themes/DoIt
# Private content via SSH (deploy key or user key required)
git submodule add git@github.com:SamirPaulb/content.git content

# Sync config and update all submodules
git submodule sync --recursive
git submodule update --init --remote --recursive
```

- Hugo Theme: https://github.com/SamirPaulb/DoIt
- Content: https://github.com/SamirPaulb/content