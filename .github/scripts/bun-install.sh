#!/usr/bin/env bash
# Installs the current directory's dependencies from its lockfile. Retries
# twice, because bun sometimes fails to extract a large tarball on CI
# runners ("Fail extracting tarball for next"). The lockfile is frozen, so a
# retry can only ever produce the same install.
set -euo pipefail

for attempt in 1 2 3; do
  if bun install --frozen-lockfile; then
    exit 0
  fi
  if ((attempt < 3)); then
    echo "::warning::bun install failed in $(pwd) (attempt $attempt of 3); retrying"
    sleep $((attempt * 5))
  fi
done
echo "::error::bun install failed in $(pwd) after 3 attempts"
exit 1
