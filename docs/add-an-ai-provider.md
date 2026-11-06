# Add an AI provider

1. Add an entry to `crates/ai/providers.json`. Set `group` to `api-key`, `local`, `app`, or `router`.

   | Field                                       | Use it for                                                                                                                                       |
   | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `id`, `name`, `group`                       | Required for every provider                                                                                                                      |
   | `icon`                                      | The logo's file name, without `.svg`                                                                                                             |
   | `dataRecipient`                             | Who receives the user's data, shown in the UI                                                                                                    |
   | `destination`                               | The name used in messages, when it differs from `name`                                                                                           |
   | `connectLabel`                              | The name on the Connect button, when it differs from `name`                                                                                      |
   | `testUrl`                                   | A hosted provider's test address. It must be `https` and require a key                                                                           |
   | `testPath`                                  | The path added to the user's address, for any provider that uses `needsUrl`                                                                      |
   | `needsUrl`                                  | Set to `true` if the user must enter an address. It also needs `testPath`                                                                        |
   | `defaultUrl`                                | The address filled in or tried first, for local providers and routers                                                                            |
   | `keyOptional`                               | Set to `true` if the provider works without a key                                                                                                |
   | `keyUrl`                                    | Where to get a key, shown as "Get a key"                                                                                                         |
   | `auth`                                      | How the key is sent: `bearer`, `x-api-key`, `x-goog-api-key`, `x-portkey-api-key`, or `api-key`                                                  |
   | `binary`                                    | The command name, for AI apps                                                                                                                    |
   | `downloadUrl`                               | The download page. Required for apps, because rows offer it when an install can't run                                                            |
   | `installCommand`                            | The official macOS and Linux install command. It must start with `npm install -g` or `curl -fsSL https://`, and it must work without typed input |
   | `installCommandWindows`                     | The Windows install command, when it differs. It must start with `npm install -g` or `irm https://`                                              |
   | `installRequires`, `installRequiresWindows` | Set to `npm` if that install needs it. Without npm, the row offers a download instead                                                            |
   | `signInCommand`                             | How to sign in. Leave it out if the app has no sign-in                                                                                           |
   | `hidden`                                    | Set to `true` to keep a provider out of the app until it has been tested with a real account                                                     |

2. Add a one-color SVG to `src/features/ai-setup/brand-icons/mono/`, and set `icon` to its file name.

3. Check that a wrong key is rejected. Send a fake key to the real endpoint, and confirm the app shows that the key didn't work.

4. Run `pnpm check`.

To check an AI app's sign-in, add a case to `check_app` in `crates/ai/src/apps.rs` that uses the app's own status command. A signed-in app then connects without a click. Only add an app with a status command that you have tested both signed in and signed out, because Davis has no other proof that the app works.
