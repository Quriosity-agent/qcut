---
version: "2026.10.26.1"
date: "2026-10-26"
channel: "stable"
---

# QCut v2026.10.26.1

## Fixed

- Native MP4, MOV and MP3 exports now apply the enabled master true-peak limiter and verify the encoded audio before publishing the output. AAC and MP3 overshoot is corrected from the same lossless intermediate, without raising quiet audio. Failures and cancellation before publication preserve an existing destination file.
- Timeline batch commands share a duration-aware deadline across the CLI, HTTP server and renderer. Explicit caller timeouts remain authoritative; uncertain mutation outcomes are reported without automatic retries.
- Custom export settings retain their custom preset identity. Authenticated desktop project snapshots synchronize the internal project file after saving.

## Verified

- PR #522 passed Linux, macOS and Windows CI. The local regression run passed 317 tests across 25 files; real audio limiting, encoded peak enforcement and project snapshot tests also ran in platform CI.
- A private 32-source desktop workflow imported media in two batches, appended all 32 timeline elements in one command, played, saved, reopened and exported 805 frames at 1470 x 630 and 24 fps. Sources remained unchanged.
- With the same +12 dB gain, the 33.54-second export measured +10.6 dBTP without limiting and -1.4 dBTP with a -1 dBTP ceiling; video packets remained identical. Separate 84-second audio checks measured -1.1 dBTP for AAC and -1.3 dBTP for MP3.

## Limitations

- True-peak export verification covers the native export path with the master limiter enabled. These results do not establish identical behavior for every codec, browser export path or third-party playback system.
- Private test footage, beauty models, native reference libraries and local validation captures are not included. Reported measurements describe the tested inputs and configurations.
