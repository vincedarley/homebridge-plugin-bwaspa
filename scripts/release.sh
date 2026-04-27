#!/usr/bin/env bash
set -euo pipefail

# Production release script
# Usage: ./scripts/release.sh [patch|minor|major] ["optional commit message"]
#
# Defaults to 'patch' if no version type is specified.
# Example: ./scripts/release.sh minor "Breaking changes"

VERSION_TYPE="${1:-patch}"
USER_MSG="${2:-}"
TIMESTAMP="$(date +%Y-%m-%d)"
AUTO_COMMIT_MSG="${USER_MSG:-chore: prepare release ${TIMESTAMP}}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not found in PATH."
  exit 1
fi

if [[ -z "$(git rev-parse --show-toplevel 2>/dev/null || true)" ]]; then
  echo "This script must run inside a git repository."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "Detached HEAD is not supported for release. Checkout a branch first."
  exit 1
fi

# Production releases must be from master or main branch
if [[ "$CURRENT_BRANCH" != "master" && "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: Production releases must be run from the 'master' or 'main' branch."
  echo "Current branch: $CURRENT_BRANCH"
  echo "Please checkout master/main first: git checkout master"
  exit 1
fi

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Invalid version type: $VERSION_TYPE"
  echo "Usage: $0 [patch|minor|major] [\"commit message\"]"
  exit 1
fi

echo "==> Checking npm authentication"
if ! npm whoami >/dev/null 2>&1; then
  echo "Not authenticated to npm. Run: npm adduser"
  exit 1
fi

echo "==> Auto-committing pending changes (if any)"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  if [[ -n "$(git diff --cached --name-only)" ]]; then
    git commit -m "$AUTO_COMMIT_MSG"
  fi
fi

echo "==> Running quality gates"
npm run lint
npm run build

echo "==> Previewing version bump"
CURRENT_VERSION="$(node -p "require('./package.json').version")"
PREVIEW_VERSION="$(npm version "$VERSION_TYPE" --no-git-tag-version --dry-run 2>&1 | grep -o 'v[0-9].*' | sed 's/^v//' || echo 'unknown')"

echo ""
echo "Current version: $CURRENT_VERSION"
echo "New version:     $PREVIEW_VERSION"
echo "Version type:    $VERSION_TYPE"
echo ""
read -p "Continue with release? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Release cancelled."
  exit 0
fi

echo "==> Bumping $VERSION_TYPE version"
NEW_VERSION="$(npm version "$VERSION_TYPE" -m "chore(release): %s")"

echo "==> Publishing to npm (latest tag)"
npm publish

echo "==> Pushing branch and tags"
git push origin "$CURRENT_BRANCH"
git push origin --tags

echo "Release complete: $NEW_VERSION"
