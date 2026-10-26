# QCut 2401 trailer issue verification

Baseline: `v2026.10.24.1` / `3cae1b560`. Scope: the four QCut claims in the
2026-10-26 StreetFighter sample report. The original media and projects were not
modified.

| Report | Finding | Change |
| --- | --- | --- |
| Q1: 32-element batch times out after 10 seconds but applies | Confirmed. The utility bridge used 10 seconds; the CLI default used 30 seconds. Both could expire before the existing renderer/HTTP batch deadlines. | Share the existing 120-second HTTP batch budget: utility 115 seconds, CLI 125 seconds. Keep explicit CLI timeouts. A real timeout says the application outcome is unknown and instructs the caller to inspect the timeline before retrying. No automatic retry. |
| Q2: final audio exceeds the limiter ceiling | Confirmed as a class of failure. The master limiter limits samples before AAC encoding; it does not guarantee encoded true peak. | Native CLI exports with the master limiter enabled now measure the final encoded audio before completing. Job status, completion events and CLI poll output include `audioValidation` and warnings for excess peaks or unavailable measurements. |
| Q3: custom 1470×630 / 24 fps export says `youtube-1080p` | Confirmed. Resolved settings always retained the fallback preset identifier. | Report `custom` when effective preset-defined width, height, fps, format or bitrate differ. Preserve the named preset when its values still match. Encoder settings are unchanged. |
| Q4: batch-import's 20-item limit is undocumented | Not reproduced. The exact release's packaged `editor-media.md` already says `Batch import (max 20 items)`; the runtime maximum is also 20. | No change. |

## Audio evidence and limits

A deterministic three-second stereo stress signal passed through the existing
master mix graph with a −1 dB limiter ceiling. Its PCM sample peak was −1.000 dB,
while its reconstructed true peak was +2.6 dBTP and its 192 kbps AAC true peak
was +2.3 dBTP. Increasing the limiter's sample rate alone also did not guarantee
the encoded ceiling in a separate noise probe.

The existing v4, v5 and v6 final sample files measured −1.2 dBTP. Earlier files
with the report's positive peaks were not retained in the supplied directory;
those historical readings are not claimed as independently reproduced.

This change adds delivery diagnostics, not a new true-peak limiter or automatic
gain correction. Exported bytes remain unchanged. The caller must lower gain or
the limiter ceiling and re-export when warned. A meter failure is `unavailable`,
never `passed`; silence is `passed` with a JSON `null` peak, and no audio stream
is `no-audio`. Cancelling the export also cancels its measuring process. The
meter's 0.1 dB output precision allows only half a displayed step of rounding.

## Regression coverage

- Delayed utility replies at 12 seconds and CLI replies at 35 seconds; explicit
  shorter deadlines; ambiguous timeout messages; partial batch results; actual
  32-element store append positions.
- Preset defaults, each overridden field, nested/top-level precedence and GIF
  frame-rate overrides.
- Real FFmpeg mix → AAC → peak validation, plus the complete native export job
  and returned warning; safe levels, silence, no-audio files and unchanged hashes.
- Meter failures, parsing errors, cancellation and CLI poll/status serialization.
- Real child processes that ignore SIGTERM: cancellation and timeout explicitly
  kill the process and wait for it to close before the export file can be removed.

The batch timing regression uses controlled clocks and the real handler/store
paths, rather than a new 32-source desktop run. Audio fixtures are synthesized
at test time; no sample footage, private models or native research binaries are
part of these changes.

## Validation results

- Combined affected suite: **260 tests in 18 files passed**, including real
  FFmpeg encoding and real child-process termination.
- Repository type checks and Web/Electron builds passed. Electron was rebuilt
  after the final subprocess fix.
- Scoped Biome and `git diff --check` passed. The three packaged/source copies
  of each changed CLI reference are byte-identical.
- Changes contain only TypeScript and Markdown. No original footage, model,
  generated audio fixture or proprietary binary is included.
