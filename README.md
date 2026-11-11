# allthings

The site is [allthings.dev](https://allthings.dev). allthingsweb.dev, the old address, redirects there at Cloudflare, path and query kept (see `infra/docs/r2-migration.md`, "Later: the full cutover").

---

## 👷‍♀️ Working on the project

### 📋 Requirements

- Bun
- git

> Requirements are checked int the `make install` but you can run `make check-dependencies`

### 📁 Directories

- `cli`: `allthings`, the command-line client for people and agents (see [cli/README.md](cli/README.md))
- `aux`: the pass-the-aux hub, a Bun service on the host's laptop at an evening: guests change the Philips Hue lights through its MCP server, within a safety policy (see [aux/README.md](aux/README.md))
- `core`: the Effect domain models, public contract and data access, shared by the Worker and the CLI
- `web`: the site on allthings.dev, a Cloudflare Worker: its pages, the public API (`/api`) and the MCP server (`/mcp`). `core` and `web` form a bun workspace: run `bun install` at the repository root
- `infra`: Cloudflare infrastructure as code, with Alchemy

### 🛠️ Installation

To ease the DX on the project, you don't necessarly have to know about Bun or other command, instead we provide a _Makefile_ that simplify it for you.

```bash
make install
```

> This is going to install everything for you.

### 🤝 Contributing

Before any Pull Request please make sure to:

- `make fmt` to apply the coding standards
- `make check` to check for issues

> this is enforced in the CI

## License

MIT, for the whole repository, the `allthings` CLI included: see [LICENSE](LICENSE).
