#!/usr/bin/env bash
# Move day, Phase 4 step 1 (docs/r2-migration.md): waits for allthings.dev
# to turn active in the allthings account, then runs the prod deploy that
# attaches media.allthings.dev, allthings.dev and www at once. Start it before
# the move is submitted, from infra/:
#
#   bash scripts/move-day-deploy.sh
#
# Secrets come from the allthings 1Password vault and are never printed:
# your own op session (the desktop app integration) can read it, and agents
# read it with OP_SERVICE_ACCOUNT_TOKEN.

set -euo pipefail
cd "$(dirname "$0")/.."

# Read the secrets first, so nothing waits on 1Password at activation.
# A failed read stops here, and so does an empty value.
NEON_READER_URL=$(op read "op://allthings/allthings site_reader/credential")
NEON_SYNC_URL=$(op read "op://allthings/allthings site_sync/credential")
LUMA_API_KEY=$(op read "op://allthings/allthings Luma API key/credential")
X_BEARER_TOKEN=$(op read "op://allthings/allthings X app/Bearer Token")
# The plan below runs while the zone is pending, when the Sync Worker
# stores images through the old account's upload Worker.
MEDIA_UPLOAD_URL=$(op read "op://allthings/allthings media upload/url")
MEDIA_UPLOAD_TOKEN=$(op read "op://allthings/allthings media upload/token")
: "${NEON_READER_URL:?empty}" "${NEON_SYNC_URL:?empty}" "${LUMA_API_KEY:?empty}" "${X_BEARER_TOKEN:?empty}"
: "${MEDIA_UPLOAD_URL:?empty}" "${MEDIA_UPLOAD_TOKEN:?empty}"
export NEON_READER_URL NEON_SYNC_URL LUMA_API_KEY X_BEARER_TOKEN MEDIA_UPLOAD_URL MEDIA_UPLOAD_TOKEN

# Prove the allthings profile can still deploy before waiting on it.
bun run plan --stage prod --profile allthings >/dev/null

# Wait for the zone to turn active. A failed check is reported, and five
# in a row stop the wait, so a broken check can't silently hold the
# deploy back; any status but pending or active stops it too.
failures=0
while true; do
  if zone=$(CLOUDFLARE_ACCOUNT_ID=af627f300cd00c4dca56aacf05bea050 NODE_OPTIONS=--dns-result-order=ipv4first \
      bunx cf@1.0.0-beta.12 --profile allthings zones get --zone f65e1c6d54e9d2e850cf025190ef8915 2>/dev/null) &&
    status=$(jq -er '(.result // .).status' <<<"$zone"); then
    failures=0
    case "$status" in
      active) break ;;
      pending) sleep 10 ;;
      *) echo "allthings.dev is $status, not pending or active: stopping" >&2; exit 1 ;;
    esac
  else
    failures=$((failures + 1))
    echo "zone check failed ($failures in a row)" >&2
    if ((failures >= 5)); then echo "zone check keeps failing: stopping" >&2; exit 1; fi
    sleep 10
  fi
done

bun run deploy --stage prod --profile allthings
