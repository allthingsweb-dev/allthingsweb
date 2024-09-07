# All Things Web dot Dev

---

## 👷‍♀️ Working on the project

### 📋 Requirements

- Bun
- git

> Requirements are checked int the `make install` but you can run `make check-dependencies`

### 📁 Directories

- `website`: the web application. Frontend + backend SSR
- `pocketbase`:

### 🛠️ Installation

To ease the DX on the project, you don't necessarly have to know about BUN or other command, instead we provide a _Makefile_ that simplify it for you.

```bash
make install
```

> This is going to install everything for you.

#### 🔤 Environment variables

You need to `cp` the `.env.dist` in a `.env` file (no versionned) and adapt the configuration in `website`

#### 🏃‍♂️ Running

Just run `make`

```bash
make serve
```

### 🤝 Contributing

Before any Pull Request please make sure to:

- `make codeclean` to apply the Coding Standards

> this is enforced in the CI
