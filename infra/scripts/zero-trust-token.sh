#!/usr/bin/env bash
# Applies infra/zero-trust-token.json: creates or updates the account-owned
# Cloudflare token the studio keeps draft collaboration's edge with (the Zero
# Trust list of collaborators, and ending a revoked one's Access sessions;
# core/src/collab/access.ts). The token's value goes straight from Cloudflare
# into 1Password ("allthings zero trust" in the allthings vault, field
# credential) and is never printed. Then, with that token, it makes the list
# "allthings draft collaborators" if it isn't there, and prints the list's id
# (not a secret) for COLLABORATOR_LIST_ID in infra/src/preview.ts.
#
# It runs on a maintainer's machine with the Cloudflare CLI (cf) signed in to
# the allthings account, which may create account tokens, and op signed in
# through OP_SERVICE_ACCOUNT_TOKEN. Requires jq and bun. Run it from the
# repository root:
#
#   bash infra/scripts/zero-trust-token.sh            # create, or update the policies in place
#   bash infra/scripts/zero-trust-token.sh --rotate   # also roll the value and store it
#
# CF_PROFILE names the cf profile to use (default: allthings).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
spec="$here/../zero-trust-token.json"
store="$here/zero-trust-store.ts"
profile=${CF_PROFILE:-allthings}
rotate=false
[[ ${1:-} == --rotate ]] && rotate=true

if [[ -z ${OP_SERVICE_ACCOUNT_TOKEN:-} ]]; then
  echo "OP_SERVICE_ACCOUNT_TOKEN is not set: op signs in with it to store the token." >&2
  exit 1
fi

name=$(jq -er .name "$spec")
account=$(jq -er .account "$spec")
export CLOUDFLARE_ACCOUNT_ID=$account
# cf 1.0.0-beta.12 fails to reach Cloudflare over IPv6 on some networks.
export NODE_OPTIONS=--dns-result-order=ipv4first

# cf prints guidance for agents on stderr; keep stdout as the JSON result and
# show stderr only when a call fails.
cf() {
  local err status=0
  err=$(mktemp)
  bunx cf@1.0.0-beta.12 --profile "$profile" "$@" 2>"$err" || status=$?
  if ((status != 0)); then
    grep -vE "AGENT|=== |cli search|Keep cf|Never include|It returns|Run \`|For API|first port" "$err" >&2
  fi
  rm -f "$err"
  return "$status"
}
result() { jq 'if type == "object" and has("result") then .result else . end'; }

echo "→ resolving permission groups for $name"
groups=$(cf accounts tokens permission-groups list | result)
policies=$(jq -c --argjson groups "$groups" --arg resource "com.cloudflare.api.account.$account" '
  .permissionGroups as $wanted
  | [$wanted[] as $n | ($groups | map(select(.name == $n)) | first) // error("unknown permission group: \($n)")]
  | [{effect: "allow", permission_groups: map({id}), resources: {($resource): "*"}}]
' "$spec")

id=$(cf accounts tokens list | result | jq -r --arg name "$name" 'map(select(.name == $name)) | first | .id // empty')

if [[ -z $id ]]; then
  echo "→ creating the token"
  cf accounts tokens create --name "$name" --policies "$policies" | result | bun "$store" store "$spec"
elif $rotate; then
  echo "→ updating the token's policies, then rolling its value"
  cf accounts tokens update "$id" --name "$name" --policies "$policies" | result | jq -e '.id' >/dev/null
  cf accounts tokens roll "$id" | result | jq 'if type == "string" then {value: .} else . end' | bun "$store" store "$spec"
else
  echo "→ updating the token's policies (its value stays the same)"
  cf accounts tokens update "$id" --name "$name" --policies "$policies" | result | jq -e '.id' >/dev/null
  bun "$store" list "$spec"
fi
