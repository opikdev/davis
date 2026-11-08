# Release Davis

The [Release workflow](../.github/workflows/release.yml) builds installers for macOS (one universal `.dmg`), Windows (`.msi` and `-setup.exe`), and Linux (`.deb`, `.rpm`, `.AppImage`).

## Publish a version

1. Set the same version in `package.json` and in `[workspace.package]` in `Cargo.toml`.
2. Commit, then tag and push: `git tag v<VERSION> && git push origin v<VERSION>`.
3. Wait for the workflow to finish. It creates a draft release with every installer attached.
4. Download each installer and check that it opens, following [Install Davis](install.md).
5. Write the release notes and publish the draft.
6. Check that the published release's address ends in `/tag/v<VERSION>`. A draft's address shows `untagged-...`, and editing a draft by that name can publish it under a new `untagged-...` tag. To fix it, run `gh api -X PATCH repos/opikdev/davis/releases/<RELEASE_ID> -f tag_name=v<VERSION>`, then delete the stray tag with `git push origin :refs/tags/untagged-<ID>`.

To build installers without a release, run the workflow from the Actions tab. They're attached to the run as artifacts.

## Signing

Releases aren't code signed. The Mac app is ad-hoc signed, which seals the bundle so macOS doesn't call the download damaged, but macOS still asks people to allow it in Privacy & Security. Windows shows SmartScreen until the installer is signed and has a reputation.

| Platform | Free option | Paid option |
|---|---|---|
| macOS | None. Notarization needs an Apple Developer Program membership. | Apple Developer Program, 99 USD a year |
| Windows | [SignPath Foundation](https://signpath.org/) signs open source projects for free, after a release exists. See the [code signing policy](code-signing.md). | An OV or EV certificate, or Azure Artifact Signing |
| Linux | No signing needed | — |

Homebrew stopped accepting casks that fail Gatekeeper on 1 September 2026, so Davis can't be in Homebrew until the Mac app is notarized.
