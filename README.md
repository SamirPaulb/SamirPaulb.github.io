# Samir's Blog

Hugo blog with automated content updates and dual deployment (GitHub Pages + Cloudflare Pages).

## Deployments

- **GitHub Pages**: https://samirpaulb.github.io (from `main` branch)
- **Cloudflare Pages**: https://samir.pages.dev (from `cloudflare-pages` branch)
 
## Repository Structure

```
SamirPaulb.github.io/
├── content/              # Blog content (private submodule)
├── themes/FixIt/         # Hugo theme (public submodule - forked)
├── hugo.toml             # Hugo configuration
├── layouts/
│   ├── _partials/custom/footer-links.html  # Custom footer links
│   └── robots.txt        # Custom robots.txt template
├── .github/workflows/
│   ├── update-content-submodule.yml    # Auto-updates content submodule
│   ├── hugo.yml                         # Builds & deploys to GitHub Pages
│   └── sync-cloudflare-pages-branch.yml # Syncs Cloudflare branch
└── .gitmodules           # Submodule configuration
```

## Automated Workflows

### 1. Content Auto-Update (`update-content-submodule.yml`)
**Trigger**: `repository_dispatch` event from content repo
**Action**: Updates content submodule, pushes to main

```
Content repo push → Webhook (repository_dispatch) → Update submodule → Push to main
                                                                           ↓
                                                          ┌────────────────┴────────────────┐
                                                          ↓ (workflow_run)      ↓ (workflow_run)
                                                          Hugo Build & Deploy    Cloudflare Sync
```

**Setup Required**:
1. Create fine-grained PAT: https://github.com/settings/tokens?type=beta
   - Repository access: Only `SamirPaulb.github.io`
   - Permissions: Contents (Read and write), Metadata (Read-only)
2. Add as `PARENT_REPO_TOKEN` secret in content repo
3. Add workflow to content repo: `.github/workflows/notify-parent.yml`

### 2. Hugo Build & Deploy (`hugo.yml`)
**Trigger**: Push to main OR `workflow_run` (after content update completes)
**Action**: Builds Hugo site with Dart Sass, deploys to GitHub Pages
**Note**: Uses `CONTENT_SUBMODULE_SSH_PRIVATE_KEY` to clone private content repo

### 3. Cloudflare Branch Sync (`sync-cloudflare-pages-branch.yml`)
**Trigger**: Push to main OR `workflow_run` (after content update completes)
**Action**: Creates/updates `cloudflare-pages` branch with domain config updates

## Configuration

### Hugo Config (`hugo.toml`)
- Base URL: `https://samirpaulb.github.io/`
- Theme: FixIt (forked at `SamirPaulb/FixIt`)
- Search: Fuse.js (client-side, no external dependencies)
- Comments: Giscus (GitHub Discussions-based)
- Analytics: Custom Vercount page view counter (self-hosted Cloudflare Worker)
- PWA: Enabled with service worker and offline page
- Image optimization: Enabled with WebP conversion

### Submodules (`.gitmodules`)
- **Theme**: https://github.com/SamirPaulb/FixIt (public fork)
- **Content**: git@github.com:SamirPaulb/content.git (private)

### Requirements
- Hugo extended v0.156.0+ (CI uses latest)
- Dart Sass 1.85.x (CI installs from GitHub releases)

## Daily Usage

**Write content in content repo:**
```bash
cd /path/to/content
vim posts/new-post.md
git add posts/new-post.md
git commit -m "Add new post"
git push origin main
```

**Everything else is automatic!** Within 2-3 minutes:
- Content submodule updated in blog repo
- Hugo builds and deploys to GitHub Pages
- Cloudflare branch synced

## Manual Operations

### Clone Repository
```bash
git clone git@github.com:SamirPaulb/SamirPaulb.github.io.git
cd SamirPaulb.github.io
git submodule update --init --recursive
```

### Update Content Submodule Manually
```bash
git submodule update --remote --merge content
git add content
git commit -m "UPDATE_CONTENT_SUBMODULE"
git push origin main
```

### Reset Submodules
```bash
# Remove submodules
git rm -f themes/FixIt content
rm -rf .git/modules/themes/FixIt .git/modules/content
git config -f .gitmodules --remove-section submodule.themes/FixIt || true
git config -f .gitmodules --remove-section submodule.content || true
git add -A
git commit -m "Remove submodules"

# Re-add submodules
git submodule add https://github.com/SamirPaulb/FixIt.git themes/FixIt
git submodule add git@github.com:SamirPaulb/content.git content
git submodule sync --recursive
git submodule update --init --recursive
git add -A
git commit -m "Re-add submodules"
```

### Local Development
```bash
# Install Hugo extended (https://gohugo.io/installation/)
# Install Dart Sass 1.85.x (https://github.com/sass/dart-sass/releases/tag/1.85.0)
hugo version
sass --version

# Update submodules
git submodule update --init --recursive

# Run local server
hugo server -D

# Build static site
hugo --minify
```

## Required Secrets

### In Blog Repository (SamirPaulb.github.io)
- `CONTENT_SUBMODULE_SSH_PRIVATE_KEY` - SSH key for accessing private content repo

### In Content Repository (content)
- `PARENT_REPO_TOKEN` - Fine-grained PAT to trigger blog repo workflows

## Resources

- **Hugo Theme**: https://github.com/SamirPaulb/FixIt (forked from hugo-fixit/FixIt)
- **Content Repo**: https://github.com/SamirPaulb/content (private)
- **View Counter**: https://web.samirpaul.workers.dev/views/js (self-hosted Vercount)
- **Hugo Docs**: https://gohugo.io/documentation/
- **FixIt Docs**: https://fixit.lruihao.cn/documentation/basics/
