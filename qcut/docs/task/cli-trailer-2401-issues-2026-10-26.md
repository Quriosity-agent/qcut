# QCut 2401 trailer issue verification

Baseline: `v2026.10.24.1` / `3cae1b560`. Scope: the four QCut claims in the
2026-10-26 StreetFighter sample report. Original media and existing projects
were not modified. The desktop check used a fresh project and isolated profile.

| Report | Finding | Change |
| --- | --- | --- |
| Q1: 32-element batch times out after 10 seconds but applies | Confirmed. The utility bridge used 10 seconds; the CLI default used 30 seconds. Both could expire before the existing renderer/HTTP batch deadlines. | Share the existing 120-second HTTP budget: utility 115 seconds, CLI 125 seconds. Explicit CLI timeouts remain supported. A true timeout reports an unknown application outcome and tells the caller to inspect the timeline before retrying; no automatic mutation retry. |
| Q2: final audio exceeds the limiter ceiling | Confirmed as a class of failure. Sample limiting before lossy encoding does not guarantee encoded true peak. | When the master limiter is enabled, native MP4, MOV and MP3 exports now limit an oversampled lossless mix, verify the encoded candidate and correct any remaining overshoot before publishing. |
| Q3: custom 1470×630 / 24 fps export says `youtube-1080p` | Confirmed. Resolved settings always retained the fallback preset identifier. | Report `custom` when effective preset-defined width, height, fps, format or bitrate differ. Keep the named preset when its values still match. |
| Q4: batch-import's 20-item limit is undocumented | Not reproduced. The exact release's packaged reference already says `Batch import (max 20 items)`; the runtime maximum is also 20. | No change. The desktop run imports 20 + 12 media files, then adds all 32 timeline elements in one request. |

## Automatic native true-peak limiting

The master limiter is deferred until after the existing track, bus, EQ, gain and
automation mix. Track and bus effects remain active; the original mix settings
are not mutated. A float32 RF64-capable PCM intermediate retains over-range
samples. Target sample-rate and channel conversion happens before four-times
oversampled limiting, with lookahead latency compensated and automatic makeup
gain disabled. Low-level audio is not unconditionally attenuated.

Every AAC or MP3 candidate is encoded from the same limited lossless PCM. The
final encoded stream is measured with FFmpeg `ebur128=peak=true`. If necessary,
the exporter applies additional attenuation and retries, at most four encodes.
A reading must be at least half a meter step below the requested ceiling so
the meter's 0.1 dB rounding cannot conceal an overshoot. Limiter headroom is
0.3 dB. See [FFmpeg's alimiter documentation](https://ffmpeg.org/ffmpeg-filters.html#alimiter)
for oversampling, latency compensation and makeup-gain controls.

Only a measured, passing candidate is atomically published on the destination
volume. A meter error, missing expected audio stream or exhausted correction
budget fails the job. Cancellation kills and waits for the subprocess before
cleanup. A pre-existing destination is preserved if cancellation precedes
publication; cancellation after publication removes the newly produced file.
Silent audio passes with a JSON `null` peak. A video without audio reports
`no-audio`; an audio-only export without audio fails.

Job status, completion events and CLI polling expose `audioValidation`, including
the measured peak, ceiling, oversampling factor, encoding attempts and added
attenuation. This changes the final native export path. Browser live preview
and the renderer export engine retain their existing dynamics; identical audio
under heavy limiting across those paths is not claimed.

## Real audio evidence

A deterministic three-second stress signal reproduced the original failure:
the old master graph's PCM sample peak was −1.000 dB, reconstructed true peak
was +2.6 dBTP, and encoded AAC measured +2.3 dBTP. Upsampling alone also failed
to guarantee the encoded ceiling in a noise probe.

The supplied v4/v5/v6 final samples measured −1.2 dBTP. Earlier files with the
report's positive readings were not retained, so those historical readings
are not claimed as independently reproduced.

A private 84-second real sample was tested with +12 dB gain and a −1 dBTP ceiling:

| Output | Before limiting | Final true peak | Encodes |
| --- | --- | --- | --- |
| AAC, 48 kHz stereo | +10.8 dBTP | −1.1 dBTP | 2 |
| MP3, 44.1 kHz mono | +10.8 dBTP | −1.3 dBTP | 1 |

The video packet hash and original source hash stayed unchanged. Synthetic
timing probes retained leading and trailing transients within one sample,
including a transient three milliseconds before the end.

## Complete desktop run with 32 real clips

The source-built Electron application was driven through the source CLI with
an isolated profile and a fresh project. The CLI batch request used its default
deadline, with no timeout override and no mutation retry.

- Imported 20 + 12 clips, then appended all **32 in one request**: **2,073 ms**,
  32 added, zero failed. Unique IDs, source order, contiguous starts and video
  durations matched the source probes.
- Actual playback produced **80 playback ticks**, advancing from 0.5 to
  1.800495 seconds; preview captures changed and the paused public time agreed.
- Saved, closed and relaunched the application. All 32 element IDs, order and
  positions survived reopening.
- Fixed missing bearer tokens in both internal project JSON clients, then
  verified actual HTTP auto-sync after a temporary project-name change,
  restoration, IPC writes on reopen and authenticated project-state export.
  All 32 timeline elements remained deeply equal; new logs had zero
  `Unauthorized` failures. The original project name was restored.
- Exported the same timeline twice at **1470×630, 24 fps**, with +12 dB master
  gain in both cases and only the master limiter enabled/disabled between them.

| Desktop export | Independent true peak | Frames | Video duration | Full decode |
| --- | --- | --- | --- | --- |
| Limiter disabled | +10.6 dBTP | 805 | 33.541667 s | Passed |
| Limiter enabled, −1 dBTP ceiling | −1.4 dBTP | 805 | 33.541667 s | Passed |

The limited job returned `audioValidation.status = "passed"`, four-times
oversampling, two encoding attempts and approximately 0.5 dB additional
attenuation. Every video packet matched between exports, as did all 32 source
hashes. The source files were not changed. Frame comparisons at 1, 16 and 30
seconds include baseline, limited output and black pixel-difference images.

This fast desktop run does not reproduce the original slow-machine timeout.
Controlled 12-second utility and 35-second CLI regressions cover the previous
deadline boundaries.

### Reproduce locally

Build Web and Electron first. Install `ffmpeg` and `ffprobe` on PATH and provide
an asset directory containing exactly 32 real MP4 clips at 1470×630 / 24 fps.
Use Node for the Playwright Electron runner:

```sh
node --experimental-strip-types scripts/editor-real-batch-workflow.ts \
  --asset-root /path/to/real-clips --output-dir /private/evidence/run --phase prepare
node --experimental-strip-types scripts/editor-real-batch-workflow.ts \
  --asset-root /path/to/real-clips --output-dir /private/evidence/run --phase export
node --experimental-strip-types scripts/editor-real-batch-workflow.ts \
  --asset-root /path/to/real-clips --output-dir /private/evidence/run --phase sidecar
```

The private output directory contains a resumable session, command results,
timeline snapshots, screenshots, playback evidence, export probes and
`index.html` comparisons. It is not intended for Git. The run creates one new
project; it does not replace an existing project.

## Regression coverage and validation

- Combined affected suite: **316 tests in 25 files passed**, including real
  FFmpeg encodes, MP4/MOV/MP3, mono/stereo, 44.1/48 kHz, silence, low ceilings,
  a real correction retry, quiet-signal preservation and video packet hashes.
- Master-only deferral, unchanged track/bus effects, missing audio, invalid
  measurements, retry exhaustion, pre/post-publication cancellation ownership,
  CLI status serialization and processes ignoring SIGTERM are covered.
- Video-only MP4/MOV container brands, video packet identity, atomic publication
  and existing-file preservation on failure/cancellation are covered.
- Internal project JSON clients now pass the current runtime bearer token;
  real HTTP tests confirm authenticated snapshots, rejected anonymous requests
  and retention of the previous sidecar when a read is rejected.
- Deadline boundaries, partial batches, explicit timeouts, 32-element store
  positions, custom presets and export-setting precedence remain covered.
- Repository type checks and the final Electron build passed. Web build passed
  for the earlier batch and metadata changes; this follow-up does not change
  Web source. The desktop harness also passed a targeted Node TypeScript check.
- Scoped Biome and `git diff --check` passed; the three CLI export references
  are byte-identical.
- Changes contain only source, tests and Markdown. No original footage, model,
  generated fixture, private desktop evidence or proprietary binary is included.
