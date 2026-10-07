#!/usr/bin/env bash
# Installs Claude Code at the version CLAUDE_CODE_VERSION pins, puts it on the
# job's PATH, and lays the types Claude Code writes beside the allthings mod
# (plugins/allthings/.claude-plugin/types/, gitignored) so its tsconfig and
# the type-aware lint resolve `claude-code`. Laying them loads the plugin
# headless under a throwaway HOME: no sign-in, no model call, no turn.
set -euo pipefail

: "${CLAUDE_CODE_VERSION:?set CLAUDE_CODE_VERSION}"
temp="${RUNNER_TEMP:-$(mktemp -d)}"
prefix="$temp/claude-code"
mkdir -p "$prefix"
(
  cd "$prefix"
  bun add --exact "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" >/dev/null
)
bin="$prefix/node_modules/.bin"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$bin" >>"$GITHUB_PATH"
fi
"$bin/claude" --version

plugin="${GITHUB_WORKSPACE:-$(pwd)}/plugins/allthings"
home="$temp/claude-home"
mkdir -p "$home"
# An unknown command is enough: the plugin loads, its types are laid, and the
# run ends without a turn.
HOME="$home" "$bin/claude" -p "/allthings-lay-types" --plugin-dir "$plugin" </dev/null >/dev/null 2>&1 || true
rm -rf "$home"
test -f "$plugin/.claude-plugin/types/claude-code/index.d.ts" || {
  echo "::error::Claude Code did not lay the allthings mod's types"
  exit 1
}
head -n 1 "$plugin/.claude-plugin/types/claude-code/index.d.ts"
