# Contribute to Davis

1. Follow the setup in the [README](README.md).
2. Read [Architecture](docs/architecture.md) for where code belongs and the design rules.
3. Make one change per pull request, with tests for what it fixes or adds.
4. Run `pnpm check`. It must pass on macOS, Windows, and Linux, and CI checks all three.

Prefer `cargo test --workspace` to testing one crate. DuckDB compiles from source, and `-p` changes the features of shared dependencies, so each crate you test on its own compiles and keeps another copy of it. Cargo never removes old builds, so run `cargo clean` if `target/` grows.

Everyone taking part follows the [Code of conduct](CODE_OF_CONDUCT.md).

Write commits as one-line conventional subjects, such as `feat(core): add paged queries`.

To add features, see [Add a backend command](docs/add-a-backend-command.md) and [Add an AI provider](docs/add-an-ai-provider.md).
