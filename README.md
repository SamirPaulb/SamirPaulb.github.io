# Samir's Blog

Hugo blog with [FixIt](https://github.com/SamirPaulb/FixIt) theme, automated dual deployment (GitHub Pages + Cloudflare Pages).

## Deployments

- **GitHub Pages**: https://samirpaulb.github.io
- **Cloudflare Pages**: https://samir.pages.dev
- **Daily Digest**: https://samirpaulb.github.io/daily/ (fetches from [daily-digest](https://github.com/SamirPaulb/daily-digest) repo)

## Architecture

```
Content repo push → webhook → update-content-submodule.yml → push to main
                                                                  ↓
                                                   ┌──────────────┴──────────────┐
                                                   ↓                             ↓
                                            hugo.yml (build)     sync-cloudflare-pages-branch.yml
                                            → GitHub Pages       → Cloudflare Pages
```

Cloudflare Pages deploys from `cloudflare-pages` branch (auto-synced from main with domain replacements).

Daily Digest runs separately in its own repo — JS on `/daily/` fetches HTML from `raw.githubusercontent.com`.

## Requirements

- Hugo extended v0.156.0+
- Dart Sass 1.85.x

## Commands

```bash
# Clone
git clone git@github.com:SamirPaulb/SamirPaulb.github.io.git
cd SamirPaulb.github.io
git submodule update --init --recursive

# Local dev
hugo server -D

# Build
hugo --minify

# Update content submodule manually
git submodule update --remote --merge content
git add content
git commit -m "UPDATE_CONTENT_SUBMODULE"
git push origin main

# Reset submodules safely
git rm --cached themes/FixIt || true
git rm --cached content || true
rm -rf themes/FixIt content
rm -rf .git/modules/themes/FixIt .git/modules/content
git config --remove-section submodule.themes/FixIt 2>/dev/null
git config --remove-section submodule.content 2>/dev/null
rm -f .gitmodules
git rm --cached .gitmodules || true

git submodule add https://github.com/SamirPaulb/FixIt.git themes/FixIt
git submodule add git@github.com:SamirPaulb/content.git content
git submodule sync --recursive
git submodule update --init --recursive
git add . && git commit -m "chore: cleanly re-add FixIt and content submodules"
```

## Secrets

| Repo | Secret | Purpose |
|------|--------|---------|
| Blog | `CONTENT_SUBMODULE_SSH_PRIVATE_KEY` | Clone private content submodule |
| Content | `PARENT_REPO_TOKEN` | Trigger blog workflows via dispatch |

## Resources

- [FixIt Theme (fork)](https://github.com/SamirPaulb/FixIt)
- [Content Repo (private)](https://github.com/SamirPaulb/content)
- [Daily Digest Repo](https://github.com/SamirPaulb/daily-digest)
- [View Counter](https://github.com/SamirPaulb/cloudflare-workers/tree/main/src/views)
