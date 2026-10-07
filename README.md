# All Things Web dot Dev

---

## 👷‍♀️ Working on the project

### 📋 Requirements

- Bun
- git

> Requirements are checked int the `make install` but you can run `make check-dependencies`

### 📁 Directories

- `app`: the Next.js web application
- `cli`: `allthings`, the command-line client for people and agents (see [cli/README.md](cli/README.md))
- `core`: the Effect domain models, public contract and data access, shared by the Worker and the CLI
- `web`: the Cloudflare Worker replacing the app: the public API and the MCP server so far. `core` and `web` form a bun workspace: run `bun install` at the repository root
- `infra`: Cloudflare infrastructure as code, with Alchemy

### 🛠️ Installation

To ease the DX on the project, you don't necessarly have to know about Bun or other command, instead we provide a _Makefile_ that simplify it for you.

```bash
make install
```

> This is going to install everything for you.

#### 🔤 Environment variables

You need to `cp` `app/example.env` to `app/.env.local`.

#### 🏃‍♂️ Running

```bash
make serve
```

### 🤝 Contributing

Before any Pull Request please make sure to:

- `make fmt` to apply the coding standards
- `make check` to check for issues

> this is enforced in the CI
