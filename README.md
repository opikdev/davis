# Davis

Local data workspace built with Rust, Tauri, and React. Your files stay on your computer, and you choose which AI to connect.

Early scaffold: the app runs onboarding, connects to an AI provider, keeps your work in project folders, opens Excel, CSV, Parquet, and JSON files in a table with a brief and column stats, has an AI analyst that can query every file in a project and explain what it finds with charts, and builds dashboards called Pages, from starting points, simple choices, or the AI, which you can present full screen or export as PDF or PNG. It can also read Postgres and MySQL tables live, and its Library offers real public datasets, downloaded straight from each publisher. Google Sheets is not built yet.

A project is a normal folder, in `Documents/Davis` by default. Davis copies your files into its `data` folder and saves each chat in `chats` and each Page in `pages`, so you can move or back up a project like any other folder.

The AI never reads your files directly. It can only ask Davis to run read-only queries over the files in the open project, and it sees at most 50 rows of each result. Each answer shows what it saw. Claude Code and API keys get the full analyst. Codex and OpenCode run with their tools off and answer one query at a time.

## Run

Install [the Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [rustup](https://rustup.rs/), Node.js, and pnpm, then run:

```sh
pnpm install
pnpm tauri dev
```

`rust-toolchain.toml` installs the pinned Rust version on first use. The first build compiles DuckDB from source and takes a few minutes.

## Platforms

Davis targets macOS, Windows, and Linux. Connecting real AI tools has only been tried on macOS so far. Windows builds need the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/), which Windows 11 includes. On Linux, saving API keys and database passwords needs a Secret Service keyring, such as GNOME Keyring or KWallet.

To install a release, see [Install Davis](docs/install.md). Releases aren't code signed yet, so macOS and Windows warn people the first time they open Davis.

## Check

```sh
pnpm check
```

This runs type checks, lint, and tests for both TypeScript and Rust. CI also opens the built app on Windows and Linux and runs the tests in `e2e/`. There's no WebDriver for the macOS web view, so check Mac changes by hand.

## Build

```sh
pnpm tauri build
```

## Privacy and code signing

Davis sends nothing anywhere unless you connect an AI and ask it something. See the [privacy policy](docs/privacy.md) and the [code signing policy](docs/code-signing.md).

## Docs

- [Install Davis](docs/install.md)
- [Connect a database](docs/connect-a-database.md)
- [Add a dataset to the Library](docs/add-a-dataset.md)
- [Release Davis](docs/release.md)
- [Architecture](docs/architecture.md)
- [Add a backend command](docs/add-a-backend-command.md)
- [Add an AI provider](docs/add-an-ai-provider.md)
- [ADR 001: Use Tauri with a separate Rust core](docs/decisions/001-tauri-with-rust-core.md)

## Contribute

See [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).

## License

[Apache-2.0](LICENSE)
