# Davis

Local data workspace built with Rust, Tauri, and React. Your files stay on your computer, and you choose which AI to connect.

Early scaffold: the app runs onboarding, connects to an AI provider, keeps your work in project folders, opens Excel, CSV, Parquet, and JSON files in a table with a brief and column stats, and has an AI analyst that can query every file in a project and explain what it finds with charts. Connections and Pages are not built yet.

A project is a normal folder, in `Documents/Davis` by default. Davis copies your files into its `data` folder and saves each chat in `chats`, so you can move or back up a project like any other folder.

The AI never reads your files directly. It can only ask Davis to run read-only queries over the files in the open project, and it sees at most 50 rows of each result. Each answer shows what it saw. Claude Code and API keys get the full analyst. Codex and OpenCode run with their tools off and answer one query at a time.

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
