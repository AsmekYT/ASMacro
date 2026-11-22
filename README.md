<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="ASMacro logo" width="128" height="128">

# ASMacro

**Build macros as block programs. Run them as real mouse and keyboard input.**

[![Release](https://img.shields.io/github/v/release/AsmekYT/ASMacro?style=flat-square&color=2563eb)](https://github.com/AsmekYT/ASMacro/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/AsmekYT/ASMacro/total?style=flat-square&color=16a34a)](https://github.com/AsmekYT/ASMacro/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/AsmekYT/ASMacro/ci.yml?style=flat-square&label=CI)](https://github.com/AsmekYT/ASMacro/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/AsmekYT/ASMacro?style=flat-square&color=eab308)](https://github.com/AsmekYT/ASMacro/stargazers)
[![License](https://img.shields.io/badge/license-AGPL--3.0%20%2B%20Commons%20Clause-orange?style=flat-square)](LICENSE)
<br>
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-475569?style=flat-square)](#-install)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Blockly](https://img.shields.io/badge/Blockly-12-4285F4?style=flat-square&logo=google&logoColor=white)](https://developers.google.com/blockly)

<br>

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0wIDBoMTF2MTFIMHpNMTMgMGgxMXYxMUgxM3pNMCAxM2gxMXYxMUgwek0xMyAxM2gxMXYxMUgxM3oiLz48L3N2Zz4=)](https://github.com/AsmekYT/ASMacro/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/AsmekYT/ASMacro/releases/latest)

[![Discord](https://img.shields.io/discord/1573856643123380264?style=flat-square&logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/tgPdKpavph)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=flat-square&logo=kofi&logoColor=white)](https://ko-fi.com/asmekyt)

<br>

[Features](#-features) · [Install](#-install) · [Hotkeys](#%EF%B8%8F-hotkeys) · [Build](#%EF%B8%8F-building-from-source) · [Translations](#-translations) · [Community](#-community) · [License](#-license)

</div>

---

## ✨ Features

| | |
|---|---|
| **Block editor** | Macros are Blockly programs: clicks, keys, text, waits, loops, variables. |
| **Screen conditions** | Image match, color match, motion in a region, OCR. |
| **Autoclicker** | Separate from macros, with click points pinned to a specific screen. |
| **Humanization** | Optional jitter on cursor paths and timing. |
| **Hotkeys** | Start/stop per macro, plus a panic key that kills whatever is running. |
| **Updates** | Signed, pulled from GitHub Releases. |
| **Offline** | No accounts, no telemetry. |

## 📦 Install

Download from [Releases](https://github.com/AsmekYT/ASMacro/releases/latest).

| System | Package |
|---|---|
| 🪟 Windows 10/11 | `ASMacro_x.y.z_x64-setup.exe` |
| <img src="https://cdn.simpleicons.org/debian/A81D33" width="16"> Debian / <img src="https://cdn.simpleicons.org/ubuntu/E95420" width="16"> Ubuntu | `ASMacro_x.y.z_amd64.deb` |
| <img src="https://cdn.simpleicons.org/fedora/51A2DA" width="16"> Fedora / RHEL | `ASMacro-x.y.z-1.x86_64.rpm` |
| <img src="https://cdn.simpleicons.org/linux/000000" width="16"> Other Linux | `ASMacro_x.y.z_amd64.AppImage` |

> [!NOTE]
> The Windows installer isn't code-signed, so SmartScreen will complain the
> first time. **More info → Run anyway.**

### 🐧 Linux setup

The `.deb` and `.rpm` install a udev rule for `/dev/uinput`. Reading input
devices still needs the `input` group:

```sh
sudo usermod -aG input $USER
```

Log out and back in. If something is still missing, Settings will say what.

> [!TIP]
> The AppImage can't install the udev rule and doesn't bundle tesseract, so use
> a package if your distro has one.

## ⌨️ Hotkeys

The autoclicker and the panic key use a low-level input hook and work
everywhere, Wayland included.

Macro start/stop and the coordinate picker go through the desktop's global
shortcut API. Native Wayland doesn't have one, so there you use the tray menu
or the buttons in the app. Windows and X11 are unaffected.

<details>
<summary><b>🌊 Wayland limitations</b> — GNOME and KDE default to Wayland. On Xorg, skip this.</summary>

<br>

- **Cursor position is estimated.** No portal exposes it, so it drifts over
  time. Set a panic key.
- **Screen capture needs a portal.** You grant it once. Without a portal
  backend there's no capture at all. This is the least-tested part of the
  Linux port, so if a vision block fails, check Settings and then
  [open an issue](https://github.com/AsmekYT/ASMacro/issues) with your
  compositor and portal backend.
- **Unicode typing needs the keyboard layout,** which Wayland hides from
  background apps. ASMacro falls back to `XKB_DEFAULT_*` or US and fails with
  an error instead of typing the wrong character. X11 reads the real layout,
  AltGr included.

</details>

## 🛠️ Building from source

Node 22+ and stable Rust.

```sh
npm install
npm run tauri dev
npm run tauri build
npm test
```

<details>
<summary><b>Linux dependencies</b></summary>

```sh
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf \
  libxkbcommon-dev \
  pkg-config build-essential tesseract-ocr tesseract-ocr-eng

# Fedora/RHEL
sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel openssl-devel libxkbcommon-devel \
  tesseract tesseract-langpack-eng
```

</details>

## 🌍 Translations

One JSON file per language, tray menu and system dialogs included:

```json
{
  "language": { "code": "fr", "name": "Français", "match": ["fr"] },
  "strings": { "panel.editor": "Éditeur", "...": "..." }
}
```

| Field | |
|---|---|
| `code` | Stored in settings. Reusing an existing code (e.g. `pl`) overrides its strings. |
| `name` | Shown in Settings → Language. |
| `match` | Locale prefixes for Auto mode. Defaults to `code`. |
| `strings` | Start from [`en.json`](src/i18n/locales/en.json). Keep `{placeholders}` and `%1` slots. Missing keys fall back to English. |

To try one without building, put it in `%APPDATA%\me.asmek.asmacro\locales`
(Windows) or `~/.config/me.asmek.asmacro/locales` (Linux) and restart. To ship
it, add it to `src/i18n/locales/`; `npm test` checks for missing keys.

## 🤝 Community

Bugs and ideas go to [Issues](https://github.com/AsmekYT/ASMacro/issues) or
[Discord](https://discord.gg/tgPdKpavph). Before a pull request, run `npm test`
and `cargo clippy --manifest-path src-tauri/Cargo.toml`.

If it saves you time, a star helps, and so does a
[coffee](https://ko-fi.com/asmekyt) ☕.

## 📄 License

[AGPL-3.0](LICENSE) with the [Commons Clause](https://commonsclause.com/).

You can use, modify and share it. If you distribute a modified version or run
it as a network service, you publish the source under the same terms. You
can't sell it, or a service that mostly consists of it.

That makes ASMacro source-available, not OSI open source. For a commercial
license, open an issue.

---

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=AsmekYT/ASMacro&type=Date)](https://star-history.com/#AsmekYT/ASMacro&Date)

<sub>Made with ❤️ by <a href="https://github.com/AsmekYT">Asmek</a></sub>

</div>
