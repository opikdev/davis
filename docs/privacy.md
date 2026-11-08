# Privacy policy

Davis has no account, analytics, crash reports, or update checks. It never sends anything to the people who make it.

## What stays on your computer

- Your files. Davis copies each file you add into the project folder, which is in `Documents/Davis` by default.
- Your chats and Pages, which are saved in the same project folder.
- Your settings, in the Davis settings folder listed under [Remove everything](#remove-everything).
- API keys, in your system's keychain: Keychain on macOS, Credential Manager on Windows, and a Secret Service keyring on Linux.

## What goes to the AI you choose

Davis only connects to an AI when you set one up and ask it something. When you ask, Davis sends that AI:

- your question and the earlier messages in that chat
- the names, row counts, and column names of the files in the open project
- the blocks on the open Page, when you ask about a Page
- the results of the queries the AI asks Davis to run, at most 50 rows each

The AI never reads your files directly. Each answer shows the queries it ran and the rows it saw.

Where that goes depends on what you connect:

| You connect | Your questions go to |
|---|---|
| Claude Code, Codex, or OpenCode | The service that tool is signed in to. Davis runs the tool on your computer. |
| An API key | That provider, such as Anthropic or OpenAI |
| A local model, such as Ollama or LM Studio | Nowhere. It runs on your computer. |

That provider's own privacy policy covers what it does with them.

## Other connections

- When you add an API key, Davis asks the provider for its list of models, so it can check the key.
- When you click **Install** for Claude Code, Codex, or OpenCode, Davis runs that tool's official install command, which downloads it from its maker.

## Remove everything

Uninstalling Davis removes the app. To also remove your data, delete:

- your project folders, in `Documents/Davis` by default
- the settings folder:
  - macOS: `~/Library/Application Support/dev.opik.davis`
  - Windows: `%APPDATA%\dev.opik.davis` and `%LOCALAPPDATA%\dev.opik.davis`
  - Linux: `~/.config/dev.opik.davis` and `~/.local/share/dev.opik.davis`
- any API keys, which you can also remove from inside Davis by disconnecting the provider. In your keychain, they're saved under `dev.opik.davis`.

## Questions

[Open an issue](https://github.com/opikdev/davis/issues) if something here is unclear, or if Davis does something this page doesn't describe.
