# Davis

Local data workspace built with Rust, Tauri, and React. Your data stays on your machine.

Early scaffold: the app starts DuckDB and reports its status.

## Run

Install [the Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [rustup](https://rustup.rs/), Node.js, and pnpm, then run:

```sh
pnpm install
pnpm tauri dev
```

`rust-toolchain.toml` installs the pinned Rust version on first use. The first build compiles DuckDB from source and takes a few minutes.

## Check

```sh
pnpm check
```

This runs type checks, lint, and tests for both TypeScript and Rust.

## Build

```sh
pnpm tauri build
```

## Docs

- [Architecture](docs/architecture.md)
- [Add a backend command](docs/add-a-backend-command.md)
- [ADR 001: Use Tauri with a separate Rust core](docs/decisions/001-tauri-with-rust-core.md)

## License

[Apache-2.0](LICENSE)
