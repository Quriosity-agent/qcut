---
version: "2026.10.27.1"
date: "2026-10-27"
channel: "stable"
---

# QCut v2026.10.27.1

## Added

- Sticker Lab can keep compatible private reference catalogs on an external drive through a persisted root shared by the desktop app and CLI. `sticker-lab root`, `set-root` and `reset-root` inspect or manage the setting; explicit roots and environment overrides retain priority.

## Fixed

- A missing or invalid private catalog reports a local error without hiding the public sticker grid. A configured unavailable drive fails explicitly instead of silently selecting another library. Reference containment, symlink rejection and resource checksum checks remain enforced.

## Verified

- PR #524 passed Linux, macOS and Windows CI, including platform-native path and Windows temporary-directory canonicalization coverage.
- A signed, notarized macOS build of the same functional code passed real GIF, static PNG, atlas-animation, PNG-sequence and alpha-video preview, import, save and reopen checks. A normal-profile test also verified three animation formats with the former local library unavailable and preserved the existing project's timeline contents.

## Limitations

- The setting selects an existing compatible catalog; it does not move files automatically. The external drive must be mounted to browse or import its library. Private-reference restrictions remain in effect.
- Desktop playback acceptance above was performed on Apple Silicon macOS; Windows and Linux coverage comes from CI and packaging checks. Private test artwork, local configuration and validation captures are not included in the release.
