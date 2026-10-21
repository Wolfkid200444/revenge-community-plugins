#!/usr/bin/env bash
# Rewrites the README plugin tables from the published index and pushes them if they changed.

set -euo pipefail
# shellcheck source=.github/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

index="$POOL_CHECKOUT/index.json"
if [ ! -f "$index" ]; then
    echo "No index published yet, leaving the README alone."
    exit 0
fi

branch="${GITHUB_REF_NAME:?}"

attempt_update() {
    bun run update-readme --index "$index" || return 1

    git add README.md || return 1
    if git diff --cached --quiet; then
        echo "README already matches the index."
        return 0
    fi

    git -c user.name='github-actions[bot]' \
        -c user.email='github-actions[bot]@users.noreply.github.com' \
        -c commit.gpgsign=false \
        commit -m "chore: update README plugin table" || return 1
    git push origin "HEAD:${branch}"
}

for attempt in 1 2 3; do
    if attempt_update; then
        exit 0
    fi

    echo "README update attempt ${attempt} failed. Syncing with ${branch}."
    git fetch origin "$branch" || break
    git reset --hard "origin/${branch}" || break
done

echo "::error::could not push the README after 3 attempts"
exit 1
