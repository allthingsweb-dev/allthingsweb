#!/usr/bin/env bash
# Move day, Phase 4 step 1 (docs/r2-migration.md): waits for allthings.dev
# to turn active in the allthings account, then runs the prod deploy that
# attaches media.allthings.dev, allthings.dev and www at once. Start it before
# the move is submitted, from infra/ of a clone of main whose web/ is built
# (`bun run build` in web/):
#
#   bash scripts/move-day-deploy.sh 2>&1 | tee move-day.log
#
# Every line it prints starts with a UTC timestamp, one per zone check, so a
# log shows the wait is alive.
#
# Secrets come from the allthings 1Password vault and are never printed:
# your own op session (the desktop app integration) can read it, and agents
# read it with OP_SERVICE_ACCOUNT_TOKEN (or the Keychain item allthings-op).

set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT=af627f300cd00c4dca56aacf05bea050
ZONE=f65e1c6d54e9d2e850cf025190ef8915
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# Deploy output can name a secret's value; keep it out of the log.
scrub() { sed -E 's/postgres(ql)?:[^ "]*/<url>/g' | grep -v -i -E "secret|token|password" || true; }

if [[ -z ${OP_SERVICE_ACCOUNT_TOKEN:-} ]] && security find-generic-password -s allthings-op >/dev/null 2>&1; then
  OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -s allthings-op -w)
  export OP_SERVICE_ACCOUNT_TOKEN
fi

# Read the secrets first, so nothing waits on 1Password at activation.
# A failed read stops here, and so does an empty value.
v() { op read "op://allthings/$1"; }
NEON_READER_URL=$(v "allthings site_reader/credential")
NEON_SYNC_URL=$(v "allthings site_sync/credential")
LUMA_API_KEY=$(v "allthings Luma API key/credential")
X_BEARER_TOKEN=$(v "allthings X app/Bearer Token")
# The plan below runs while the zone is pending, when the Sync Worker
# stores images through the old account's upload Worker.
MEDIA_UPLOAD_URL=$(v "allthings media upload/url")
MEDIA_UPLOAD_TOKEN=$(v "allthings media upload/token")
# The draft preview reads through draft_collab and seals rounds with this key.
NEON_COLLAB_URL=$(v "allthings draft_collab/credential")
COLLAB_ANSWERS_KEY=$(v "allthings collab answers key/credential")
# The writers tell the site its data changed with this token (web/src/refresh.ts).
SITE_REFRESH_TOKEN=$(v "allthings site refresh/credential")
: "${NEON_READER_URL:?empty}" "${NEON_SYNC_URL:?empty}" "${LUMA_API_KEY:?empty}" "${X_BEARER_TOKEN:?empty}"
: "${MEDIA_UPLOAD_URL:?empty}" "${MEDIA_UPLOAD_TOKEN:?empty}"
: "${NEON_COLLAB_URL:?empty}" "${COLLAB_ANSWERS_KEY:?empty}" "${SITE_REFRESH_TOKEN:?empty}"
export NEON_READER_URL NEON_SYNC_URL LUMA_API_KEY X_BEARER_TOKEN MEDIA_UPLOAD_URL MEDIA_UPLOAD_TOKEN
export NEON_COLLAB_URL COLLAB_ANSWERS_KEY SITE_REFRESH_TOKEN
log "secrets read"

# Prove the allthings profile can still deploy before waiting on it.
# --no-input: it must never wait on a prompt with no one to answer it.
if ! plan=$(bun run plan --stage prod --profile allthings </dev/null 2>&1); then
  scrub <<<"$plan" | tail -20
  log "plan failed: stopping before the wait"
  exit 1
fi
scrub <<<"$plan" | grep -E "Plan:" || true
built=$(git rev-parse HEAD)
log "planned from $(git log --oneline -1); waiting for $ZONE to turn active"

# Wait for the zone to turn active. A failed check is reported, and five
# in a row stop the wait, so a broken check can't silently hold the
# deploy back; any status but pending or active stops it too. bunx may
# print a line before the JSON ("Saved lockfile"), so the JSON is read from
# its first brace.
failures=0
while true; do
  if zone=$(CLOUDFLARE_ACCOUNT_ID=$ACCOUNT NODE_OPTIONS=--dns-result-order=ipv4first \
      bunx cf@1.0.0-beta.12 --profile allthings zones get --zone "$ZONE" 2>/dev/null) &&
    status=$(sed -n '/^{/,$p' <<<"$zone" | jq -er '(.result // .).status'); then
    failures=0
    log "zone $status"
    case "$status" in
      active) break ;;
      pending) sleep 10 ;;
      *) log "allthings.dev is $status, not pending or active: stopping"; exit 1 ;;
    esac
  else
    failures=$((failures + 1))
    log "zone check failed ($failures in a row)"
    if ((failures >= 5)); then log "zone check keeps failing: stopping"; exit 1; fi
    sleep 10
  fi
done

# Deploy what main is now. If main moved while this waited, catch up first,
# so the deploy never rolls prod back to an older build.
git fetch -q origin main
if [[ $(git rev-parse origin/main) != "$built" ]]; then
  log "main moved to $(git log --oneline -1 origin/main): rebuilding"
  git checkout -q --detach origin/main
  for d in core web infra; do (cd "../$d" && bash ../.github/scripts/bun-install.sh >/dev/null 2>&1); done
  (cd ../web && bun run build >/dev/null 2>&1)
fi
log "deploying $(git log --oneline -1)"
rc=0
bun run deploy --stage prod --profile allthings --yes </dev/null 2>&1 | scrub || rc=$?
log "deploy exited $rc"
((rc == 0)) || exit "$rc"

# Build the new host's pages into the page store (web/src/prewarm.ts), as
# every prod deploy does. allthings.dev may not answer until its certificate
# is issued, so this asks every 15 s for up to 10 minutes. Best effort: it
# never fails the move, but says how it went. The token goes on stdin.
for _ in $(seq 40); do
  code=$(printf 'Authorization: Bearer %s\n' "$SITE_REFRESH_TOKEN" |
    curl -sS -o /dev/null -w '%{http_code}' -X POST -H @- --max-time 300 https://allthings.dev/_site/prewarm 2>/dev/null) || code=000
  log "prewarm: HTTP $code"
  [[ $code == 200 ]] && exit 0
  sleep 15
done
log "prewarm never answered 200: run it again by hand"
