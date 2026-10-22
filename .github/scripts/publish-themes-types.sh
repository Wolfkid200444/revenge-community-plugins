#!/usr/bin/env bash
# Builds the Themes API types package and pushes it to its own repository if it changed.

set -euo pipefail

repo="${THEMES_TYPES_REPO:?}"
token="${THEMES_TYPES_PUSH_TOKEN:?THEMES_TYPES_PUSH_TOKEN secret is not set}"
branch="${THEMES_TYPES_BRANCH:-main}"
out="plugins/api.themes/build/types-package"
checkout="${RUNNER_TEMP:-/tmp}/themes-types"

(cd plugins/api.themes && bun run build:types)

rm -rf "$checkout"
git clone --depth 1 "https://x-access-token:${token}@github.com/${repo}.git" "$checkout"

# Don't override .git
find "$checkout" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$out"/. "$checkout"/

cd "$checkout"
git add -A
if git diff --cached --quiet; then
    echo "Types already up to date."
    exit 0
fi

version="$(bun -p 'require("./package.json").version')"
git -c user.name='github-actions[bot]' \
    -c user.email='github-actions[bot]@users.noreply.github.com' \
    -c commit.gpgsign=false \
    commit -m "chore: update to ${version}" \
    -m "From ${GITHUB_REPOSITORY:-local}@${GITHUB_SHA:-unknown}"
git push origin "HEAD:${branch}"
