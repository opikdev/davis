# Install Davis

Download Davis from the [Releases page](https://github.com/opikdev/davis/releases). Davis isn't code signed yet, so macOS and Windows warn you the first time you open it. The steps below get past that warning, and you only need them once.

## macOS

Download the `.dmg`. It runs on Apple silicon and Intel Macs.

1. Open the `.dmg` and drag Davis to Applications.
2. Open Davis. macOS shows "Davis" Not Opened and says Apple could not verify it. Click **Done**, not **Move to Trash**.
3. Open **System Settings**, go to **Privacy & Security**, and scroll down to **Security**.
4. Next to the message about Davis, click **Open Anyway**. Click **Open Anyway** again to confirm, then enter your password.

On macOS 14 or earlier, you can instead Control-click Davis in Applications, choose **Open**, then click **Open** again.

If macOS says Davis is damaged, the download is broken. Download it again, and if that doesn't help, [open an issue](https://github.com/opikdev/davis/issues).

## Windows

Download the `-setup.exe`, or the `.msi` if your company installs apps that way. Davis needs the WebView2 runtime, which Windows 11 includes. On Windows 10, the installer downloads it if it's missing.

1. Open the installer. If Windows says it protected your PC, click **More info**, then **Run anyway**.
2. Follow the installer.

## Linux

| Your system | Download | Install |
|---|---|---|
| Ubuntu, Debian | `.deb` | `sudo apt install ./Davis_<VERSION>_amd64.deb` |
| Fedora, openSUSE | `.rpm` | `sudo dnf install ./Davis-<VERSION>-1.x86_64.rpm` |
| Any other | `.AppImage` | `chmod +x Davis_<VERSION>_amd64.AppImage`, then open it |

To save API keys, Davis needs a Secret Service keyring, such as GNOME Keyring or KWallet. Claude Code, Codex, and OpenCode sign-in doesn't need one.

## Uninstall

| Your system | Uninstall |
|---|---|
| macOS | Drag Davis from Applications to the Trash |
| Windows | Open **Settings → Apps → Installed apps**, find Davis, and choose **Uninstall** |
| Ubuntu, Debian | `sudo apt remove davis` |
| Fedora, openSUSE | `sudo dnf remove davis` |
| AppImage | Delete the `.AppImage` file |

Uninstalling never deletes your projects in `Documents/Davis`. To remove them and your settings too, see [Remove everything](privacy.md#remove-everything).

## Why the warnings

macOS and Windows trust an app when its developer pays for a certificate that proves who made it. Davis doesn't have those certificates yet. Each release is built from this repository by the [Release workflow](../.github/workflows/release.yml), so you can check exactly what went into it.
