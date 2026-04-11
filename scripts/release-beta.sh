#!/usr/bin/env bash
set -euo pipefail

# Optional commit message for the auto-commit of pending work.
USER_MSG="${1:-}" 
TIMESTAMP="$(date +%Y-%m-%d)"
AUTO_COMMIT_MSG="${USER_MSG:-chore: prepare beta release ${TIMESTAMP}}"

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

echo "==> Bumping prerelease version"
NEW_VERSION="$(npm version prerelease --preid=beta -m "chore(release): %s")"

echo "==> Publishing to npm with beta dist-tag"
npm publish --tag beta

echo "==> Pushing branch and tags"
git push origin "$CURRENT_BRANCH"
git push origin --tags

echo "Release complete: $NEW_VERSION"
