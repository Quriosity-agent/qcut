---
version: "2026.11.06.1"
date: "2026-11-06"
channel: "stable"
---

# QCut v2026.11.06.1

### Fixed

- Secondary timeline actions remain accessible in narrow editor panels through compact tool and option menus. Playback, common editing actions and zoom stay visible.
- Switching between Default and Audio layouts restores each preset's saved panel sizes, including after custom resizing and reloading the project.
- Preview controls wrap within narrow panels so portrait projects keep their fullscreen and playback controls accessible.
- Long project names and compact header labels no longer overlap the project menu or push Export off screen in small windows.

### Verified

- PR #534 passed Ubuntu, Windows and macOS CI, coverage checks, and 40 targeted unit tests.
- Real macOS Electron acceptance covered six layouts at 1280x800, 1440x900 and 1920x1080, plus 24 localized header cases, layout persistence, keyboard interaction and playback.
- Four narrow-window timeline editing flows passed. The P1 editor flow passed twice, including effects, transitions, compact tracks and cutout quality controls.

### Limitations

- Desktop visual acceptance used macOS at DPR 1. This layout release does not add Windows desktop screenshots, multi-monitor or system-scaling acceptance, or repeat video-export parity tests.
