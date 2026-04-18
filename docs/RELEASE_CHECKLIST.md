# Release Process

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and publishing.

## How It Works

1. **Commit with Conventional Commits format** to `develop` branch
2. **CI automatically determines version** based on commit messages
3. **Automatic release**: version bump, CHANGELOG update, npm publish, GitHub Release

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

| Type | Description | Version Bump |
|------|-------------|--------------|
| `fix:` | Bug fixes | Patch (1.0.0 → 1.0.1) |
| `feat:` | New features | Minor (1.0.0 → 1.1.0) |
| `feat!:` or `BREAKING CHANGE:` | Breaking changes | Major (1.0.0 → 2.0.0) |
| `docs:`, `chore:`, `style:`, `refactor:`, `test:` | Other changes | No release |

### Examples

```bash
# Patch release
git commit -m "fix: resolve session_id not working for Codex"

# Minor release
git commit -m "feat: add support for new model"

# Major release
git commit -m "feat!: change API response format"
# or
git commit -m "feat: change API response format

BREAKING CHANGE: response structure has changed"
```

## Pre-Merge Checklist

Before merging to `develop`:

- [ ] Tests pass locally (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Release-time live E2E passes for the intended backends (`ACM_LIVE_E2E=1 ACM_LIVE_E2E_AGENTS=claude,codex npm run test:live`, or `ACM_LIVE_E2E_AGENTS=all` for all backends; add `ACM_LIVE_E2E_SURFACE=all` to cover both ai-cli and MCP server surfaces)
- [ ] Package contents look correct (`npm pack --dry-run`)
- [ ] Commit messages follow Conventional Commits format
- [ ] PR has been reviewed (if applicable)

## Important: Git Tags

semantic-release uses git tags to determine the current version. **Tags must exist on the `develop` branch.**

If releases fail with version errors:

1. Check existing tags: `git tag -l 'v*'`
2. Ensure the latest version tag exists on `develop`
3. If missing, create it: `git tag vX.X.X && git push origin vX.X.X`

## npm Trusted Publishing Setup

This project uses OIDC trusted publishing (no npm token required).

Configuration on npmjs.com:
- Organization/user: `mkXultra`
- Repository: `ai-cli-mcp`
- Workflow filename: `publish.yml`
