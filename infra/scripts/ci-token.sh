#!/usr/bin/env bash
# Applies infra/ci-token.json: creates or updates the account-owned Cloudflare
# token GitHub Actions deploys with, and keeps the repository's
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets in step. The token's
# value goes straight from Cloudflare into the secret and is never printed.
#
# It runs on a maintainer's machine with the Cloudflare CLI (cf) signed in to
# the allthings account; that sign-in may create account tokens, so no Global
# API Key or token-minting token exists anywhere. Requires gh, jq and bun.
#
#   bash infra/scripts/ci-token.sh            # create, or update the policies in place
#   bash infra/scripts/ci-token.sh --rotate   # also roll the value and update the secret
#
# CF_PROFILE names the cf profile to use (default: allthings).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
spec="$here/../ci-token.json"
repo=allthingsweb-dev/allthingsweb
profile=${CF_PROFILE:-allthings}
rotate=false
[[ ${1:-} == --rotate ]] && rotate=true

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

set_secret() {
  jq -er '.value // empty' | gh secret set CLOUDFLARE_API_TOKEN --repo "$repo"
  gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$repo" --body "$account"
}

if [[ -z $id ]]; then
  echo "→ creating the token"
  cf accounts tokens create --name "$name" --policies "$policies" | result | set_secret
  echo "✓ created \"$name\" and set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID on $repo"
  exit 0
fi

echo "→ updating the token's policies (its value stays the same)"
cf accounts tokens update "$id" --name "$name" --policies "$policies" | result | jq -e '.id' >/dev/null
if $rotate; then
  echo "→ rolling the token's value"
  cf accounts tokens roll "$id" | result | jq 'if type == "string" then {value: .} else . end' | set_secret
  echo "✓ rotated \"$name\" and updated CLOUDFLARE_API_TOKEN on $repo"
else
  echo "✓ \"$name\" now has the policies in ci-token.json"
fi
