# Samir's Blog

Hugo blog with automated content updates and dual deployment (GitHub Pages + Cloudflare Pages).

## 🌐 Deployments

- **GitHub Pages**: https://samirpaulb.github.io (from `main` branch)
- **Cloudflare Pages**: https://samir.pages.dev (from `cloudflare-pages` branch)

## 📦 Repository Structure

```
SamirPaulb.github.io/
├── content/              # Blog content (private submodule)
├── themes/DoIt/          # Hugo theme (public submodule)
├── hugo.toml            # Hugo configuration
├── .github/workflows/
│   ├── update-content-submodule.yml    # Auto-updates content submodule
│   ├── hugo.yml                         # Builds & deploys to GitHub Pages
│   └── sync-cloudflare-pages-branch.yml # Syncs Cloudflare branch
└── .gitmodules          # Submodule configuration
```

## 🔄 Automated Workflows

### 1. Content Auto-Update (`update-content-submodule.yml`)
**Trigger**: When content repo pushes to main
**Action**: Updates content submodule → pushes to main → triggers builds

```
Content repo push → Webhook → Update submodule → Push to main
                                                      ↓
                                      ┌───────────────┴────────────────┐
                                      ↓                                ↓
                              Hugo Build & Deploy            Cloudflare Sync
```

**Setup Required**:
1. Create fine-grained PAT: https://github.com/settings/tokens?type=beta
   - Repository access: Only `SamirPaulb.github.io`
   - Permissions: Contents (Read and write), Metadata (Read-only)
2. Add as `WORKFLOW_TOKEN` secret in content repo
3. Add workflow to content repo (see `content/.github/workflows/update-content-submodule.yml`)

### 2. Hugo Build & Deploy (`hugo.yml`)
**Trigger**: Push to main branch (Deploy key ```CONTENT_SUBMODULE_SSH_PRIVATE_KEY``` used for cloning private content repo)
**Action**: Builds Hugo site → deploys to GitHub Pages

### 3. Cloudflare Branch Sync (`sync-cloudflare-pages-branch.yml`)
**Trigger**: Push to main branch
**Action**: Creates/updates `cloudflare-pages` branch with domain config updates

## 🔧 Configuration

### Hugo Config (`hugo.toml`)
- Base URL: `https://samirpaulb.github.io/`
- Theme: DoIt
- Private content via submodule

### Submodules (`.gitmodules`)
- **Theme**: https://github.com/SamirPaulb/DoIt (public)
- **Content**: git@github.com:SamirPaulb/content.git (private)

## 🚀 Daily Usage

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

## 🛠️ Manual Operations

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
git commit -m "Update content submodule"
git push origin main
```

### Reset Submodules
```bash
# Remove submodules
git rm -f themes/DoIt content
rm -rf .git/modules/themes/DoIt .git/modules/content
git config -f .gitmodules --remove-section submodule.themes/DoIt || true
git config -f .gitmodules --remove-section submodule.content || true
git add -A
git commit -m "Remove submodules"

# Re-add submodules
git submodule add https://github.com/SamirPaulb/DoIt.git themes/DoIt
git submodule add git@github.com:SamirPaulb/content.git content
git submodule sync --recursive
git submodule update --init --recursive
git add -A
git commit -m "Re-add submodules"
```

### Local Development
```bash
# Install Hugo (https://gohugo.io/installation/)
hugo version

# Update submodules
git submodule update --init --recursive

# Run local server
hugo server -D

# Build static site
hugo --minify
```

## 🔑 Required Secrets

### In Blog Repository (SamirPaulb.github.io)
- `CONTENT_SUBMODULE_SSH_PRIVATE_KEY` - SSH key for accessing private content repo

### In Content Repository (content)
- `WORKFLOW_TOKEN` - Fine-grained PAT to trigger blog repo workflows

## 📚 Resources

- **Hugo Theme**: https://github.com/SamirPaulb/DoIt
- **Content Repo**: https://github.com/SamirPaulb/content
- **Hugo Docs**: https://gohugo.io/documentation/