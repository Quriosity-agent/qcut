---
version: "2026.11.10.2"
date: "2026-11-09"
channel: "stable"
---

# QCut v2026.11.10.2

### Fixed

- A native export with the master limiter on no longer runs its sound on in silence past the end of the picture. The mix counted every separate audio clip's source length, before its trims and speed, as time it plays, so a clip trimmed at its start or end (or played faster than 1×) stretched the limited mix with digital silence: a 281 s programme whose ambience bed was trimmed 204 s at its start exported 418 s of audio under 281 s of picture. The sound now ends where the last clip stops playing, as it does with the limiter off; the unlimited export was never affected.
