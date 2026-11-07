# Davis

Local data workspace built with Rust, Tauri, and React. Your files stay on your computer, and you choose which AI to connect.

Early scaffold: the app runs onboarding, connects to an AI provider, and opens CSV, Parquet, and JSON files in a table, and answers questions about them with charts. Connections and Pages are not built yet.

## Run

Install [the Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [rustup](https://rustup.rs/), Node.js, and pnpm, then run:

```sh
pnpm install
pnpm tauri dev
```

`rust-toolchain.toml` installs the pinned Rust version on first use. The first build compiles DuckDB from source and takes a few minutes.

## Platforms

Davis targets macOS, Windows, and Linux. Connecting real AI tools has only been tried on macOS so far. Windows builds need the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/), which Windows 11 includes. On Linux, saving API keys needs a Secret Service keyring, such as GNOME Keyring or KWallet.

Release builds aren't code signed yet, so macOS and Windows warn people who open them.

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
- [Add an AI provider](docs/add-an-ai-provider.md)
- [ADR 001: Use Tauri with a separate Rust core](docs/decisions/001-tauri-with-rust-core.md)

## Contribute

See [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).

## License

[Apache-2.0](LICENSE)
