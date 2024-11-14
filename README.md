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

You need to `cp` `website/.env.dist` in `website/.env`. Currently, you must have
Pocketbase running locally or have access to a production instance in order to
start the website.

#### 🏃‍♂️ Running

Just run `make`

```bash
make serve
```

### 🤝 Contributing

Before any Pull Request please make sure to:

- `make fmt` to apply the coding standards
- `make check` to check for issues

> this is enforced in the CI
