# Agent guide

This file is the canonical instruction file for every coding agent in this repository. `CLAUDE.md` is a symlink to it.

## Working here

- Understand the problem before changing code, and verify the real outcome: after merge, check the production deploy, not just green checks.
- Keep each PR tightly scoped and easy to review. Don't stack PRs; wait for a dependency to merge first.
- CodeRabbit reviews every PR. Investigate every finding, fix what's right, and reply with evidence where you disagree.
- Use bun and bunx for JavaScript, and uv for Python. Never npm, npx, yarn, pnpm or pip.
- Before pushing, run the checks of each package you changed (`app/`, `atw-cli/`, `tools/pr-header/`): `bun run check`, `bun run typecheck` and `bun run test`. CI runs the same.

## General guidelines

- Do not add documentation (e.g., README.md updates, docs/ folder, etc.) for code changes if not explicitly requested.
- When instructed to refactor code, only make the changes requested. Do not add additional changes or improvements unless explicitly requested. Do not leave comments like //removed and moved to x.tsx etc.
- Do not add example components, code, or other explanatory content to the codebase unless explicitly requested.

## Agent tooling layout

`.agents/` is the canonical agent-tooling tree. Other paths are thin symlink bridges into it:

| Path | Target | Why |
| --- | --- | --- |
| `CLAUDE.md` | `AGENTS.md` | Claude Code reads `CLAUDE.md` |
| `.claude/skills` | `../.agents/skills` | Claude Code loads skills through `.claude/`; Codex, Gemini CLI and VS Code read `.agents/skills/` natively |

- `.agents/skills/` holds the shared skills; `skills-lock.json` records their sources.
- `.agents/local/` and `**/settings.local.json` are personal and ignored.

On a clone with `core.symlinks=false` (some Windows setups), the bridges check out as plain text files. Enable symlinks with `git config core.symlinks true` and check out again.
