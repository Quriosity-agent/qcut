---
version: "2026.10.15.2"
date: "2026-10-15"
channel: "stable"
---

# QCut v2026.10.15.2

## Fixes

- Make timeline placement consistent within half a frame; report blocked moves accurately instead of returning false success.
- Add append placement, frame-based timing, and media-aware project creation to the editor CLI.
- Read video duration separately from trailing audio, preserve custom canvas settings, and serialize project-settings writes.
- Recover closed editor windows, wait for readiness, and prevent expired requests from executing later.
- Improve session argument validation, flat JSON output, command help, and safe screenshot output.

## Validation

- PR #503 passed Linux, Windows and macOS CI, CodeRabbit, Devin Review, security and patch coverage checks; all 13 review threads were resolved.
- Claude reported two successful rebuilt-app CLI workflow runs after review fixes, including automatic window recovery. One unrelated timing test failed under load and passed three isolated reruns.

Source: https://github.com/Quriosity-agent/qcut/pull/503
