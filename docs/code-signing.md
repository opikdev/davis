# Code signing policy

Davis is applying for free Windows code signing from the SignPath Foundation. Until that's approved, releases aren't signed. Once it is, Windows releases will carry this notice:

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## What gets signed

Only the Windows installers (`-setup.exe` and `.msi`) and the `Davis.exe` inside them. They're built from this repository by the [Release workflow](../.github/workflows/release.yml) from a version tag. Nothing built elsewhere is signed.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [opikdev](https://github.com/opikdev) |
| Approvers | [opikdev](https://github.com/opikdev) |

A change from anyone outside this list is reviewed before it's merged. Every release needs an approver to sign off before it's signed.

## Privacy

Davis doesn't send anything to anyone unless you ask it to. When you connect an AI and ask a question, Davis sends that AI what's needed to answer. [The privacy policy](privacy.md) lists exactly what.
