# QCut Editor CLI — Export, Recording & Utilities

See [editor-core.md](editor-core.md) for connection options, flags, and workflows.

---

## Export Commands

### List presets

```bash
qcut editor:export:presets
```

### Get recommended settings

```bash
qcut editor:export:recommend --project-id <id> --target tiktok
```

Targets: `youtube` (YouTube), `tiktok` (TikTok), `instagram-reel` (Instagram Reels), `twitter` (X/Twitter), etc.

### Start export

```bash
# The project's own size and frame rate (the default)
qcut editor:export:start \
  --project-id <id> --output ~/Movies/开场_粗剪.mp4 --poll

# With preset
qcut editor:export:start \
  --project-id <id> --preset youtube-1080p --poll

# Custom settings
qcut editor:export:start \
  --project-id <id> \
  --data '{"width":1920,"height":1080,"fps":30,"format":"mp4"}' \
  --output-dir ./exports --poll --timeout 600

# Only 2:35.583–3:05.75 of the timeline, as it plays in the full export
qcut editor:export:start \
  --project-id <id> --start-time 155.583 --end-time 185.75 \
  --output ~/Movies/开场_09段.mp4 --poll

# With cursor + auto-zoom enhancements
qcut editor:export:start \
  --project-id <id> --preset youtube-1080p \
  --cursor-sway 1.0 --cursor-blur 0.3 --auto-zoom --poll

# GIF export with options
qcut editor:export:start \
  --project-id <id> --format gif \
  --gif-fps 20 --gif-loop --gif-quality 10 --poll

# An exact file, with one WAV per bus beside it
qcut editor:export:start \
  --project-id <id> --output ~/Movies/开场_粗剪.mp4 --stems --poll

# A clean plate: the picture and sound without the title and caption tracks
qcut editor:export:start \
  --project-id <id> --exclude-tracks <titles-track>,<captions-track> \
  --output ~/Movies/开场_底片.mp4 --poll

# An intermediate for a later grade: the project's picture at 24 Mbps
qcut editor:export:start \
  --project-id <id> --data '{"bitrate":"24Mbps"}' \
  --output ~/Movies/开场_中间片.mp4 --poll

# Keep the intermediate files and the FFmpeg commands, to look into a result
qcut editor:export:start \
  --project-id <id> --keep-temp --output ~/Movies/开场_查.mp4 --poll --json
```

Where the file goes:

| Flag | Meaning |
|------|---------|
| `--output <file>` | That file; the format's extension is added when it has none |
| `--output-dir <folder>` | That folder, the file named after the project: `<project name>-<YYYY-MM-DD-HHMMSS>.<format>` |
| `--filename <name>` | The file's name in `--output-dir` (`./output` without one); an absolute path is used as it is |
| `--stems` | Also writes one WAV per bus beside the export, `<file name>-<bus>.wav`, once it is done (see [editor-mix.md](editor-mix.md)); needs one of the three above |
| `--exclude-tracks <id,…>` | Leaves those tracks out of this export, picture and sound; the project is not changed (see [Leaving tracks out](#leaving-tracks-out)) |
| `--keep-temp` | Keeps the export's intermediate files and its FFmpeg commands (see [Keeping the intermediate files](#keeping-the-intermediate-files)) |

With none of them the export goes to
`Documents/QCut/Exports/<project name>-<YYYY-MM-DD-HHMMSS>.<format>`.
Characters a file name cannot hold become `-`, a name with nothing left is
replaced by the project id, and a name already in the folder gets `-2`, `-3`…
so an export never writes over an earlier one.

Without `--preset`, the export is the project's own picture: its canvas
size (an odd side rounded down to even) and frame rate, as MP4, at the
bitrate of the YouTube preset of that size (5 Mbps up to 720p, 8 Mbps up to
1080p, 45 Mbps above), and the job reports `presetId: "project"`. A 1470×630,
24 fps project exports at 1470×630, 24 fps; before 2026.11.10 it came out at
1920×1080, 30 fps unless `--data` said otherwise.

`--data` takes the same settings one at a time: `width`, `height`, `fps`,
`format` and `bitrate`. Without `--preset` the bitrate goes with the size
that is exported, by its longer side, so a `width`/`height` given in `--data`
gets the bitrate of that size (a 3840×1608 export of a 1470×630 project is
45 Mbps, not the project's 8). With `--preset` the preset's bitrate stays
unless `bitrate` is given.

`bitrate` is a string with its unit, megabits or kilobits a second:
`"24Mbps"`, `"24M"`, `"8000kbps"` or `"8000k"` (any case, a decimal point
allowed: `"7.5Mbps"`). The job reports it as `"24Mbps"`, or as `"7500kbps"`
when it is not a whole number of megabits. Anything else (a number, a
`"24"` without its unit) is refused, saying what it takes; up to 2026.11.10.2
it exported at 8 Mbps without a word.

The returned job uses `presetId: "custom"` when its effective width, height,
fps, format, or bitrate differs from the selected preset (or from the
project's picture). Unchanged values keep the preset ID. Omitted settings
still come from that preset; nested `settings` values take precedence over
the same top-level fields.

### Export a range

`--start-time` and `--end-time` (timeline seconds; either may be left out)
write only that part of the timeline, for checking a stretch without
exporting the whole programme. Both snap to the export's frames. The range
export is the full export cut to the range, not a separate render of the
clips in it:

- every clip, overlay, transition and the mix keep their timeline timing;
  a limiter, ducking, fade or effect reaching into the range hears what
  plays before it, as in the full export;
- clips whose picture cannot show in the range are not decoded for their
  picture (their sound still is), and overlays outside the range are not
  drawn, which is where the time is saved;
- the picture in the range matches the full export frame for frame (it is
  encoded once more from the finished picture); the sound is the same mix,
  encoded on its own, so its AAC frames differ from the full export's.

Native MP4 and MOV exports only: a GIF or MP3 range, or a timeline that
exports through the renderer engine, is refused. A range outside the
timeline is refused rather than cut to fit; one ending after the picture
ends where the picture ends. The job reports the range it wrote (`range`)
and the file's `duration`.

### Leaving tracks out

`--exclude-tracks <track-id>,<track-id>` (`excludeTracks` in the HTTP
request, an array or a comma-separated string) exports the timeline as if
those tracks were hidden and muted: their picture is not drawn and their
sound is not mixed. The project is not touched, so there is nothing to put
back afterwards. Track ids come from `editor track list`; an id the timeline
does not have is refused with 400, naming the tracks it does have.

The engine is chosen from what is left, so leaving out the only track that
needs the editor window's engine (clips with a `filterStack`, say) makes the
rest a native export. Native exports only: an export that still runs in the
editor window refuses the option, naming what in the timeline sent it there.

### What the timeline's gaps and frames become

- **Gaps on the main track are black and silent.** Wherever no main-track
  clip plays (before the first clip, between two clips, after the last one
  while an overlay, a caption or sound goes on) the picture is black and the
  main track is silent, for exactly the gap's length. A timeline whose first
  clip starts at 5 s exports 5 s of black first; there is no need to put a
  black clip there. The export ends where the timeline ends.
- **Clips need not sit on frames.** Frames are counted from the start of
  the timeline: frame *n* shows what the timeline has at *n*/fps (a clip
  that starts within 1 ms after a frame still takes it, as in the preview).
  Each main-track clip is written as exactly the frames from its start to
  the next clip's start, and its sound as the samples of the same span, so a
  clip 2.425333 s long moves nothing after it. Up to 2026.11.10.2 each clip
  was rounded up to whole frames on its own and the picture after it ran
  later than the sound by the remainder: eleven such cuts left the end of
  one trailer 5 frames late. `editor timeline export` reports the clips that
  start or end between frames (`frameAlignment`), and
  `editor timeline snap --to frames` puts them on frames (see
  [editor-timeline.md](editor-timeline.md#frames-clip-edges-and-command-times)).
- **Nor need an in-point sit on a frame of its file.** Each output frame
  shows the source frame on screen at its time, on the main track and in an
  overlay, whatever the file's own frame rate: a clip trimmed to 1.508 s of
  a 24 fps file starts on the frame that began at 1.5 s, and a 30 fps file
  on a 24 fps timeline shows, frame by frame, what the preview shows. The
  sound starts at the in-point itself, to the sample. Up to 2026.11.10.2
  such a clip began on the next source frame (its first frame held for two,
  or the whole clip a frame ahead). One case is left: a source frame held
  for more than a quarter of a second before the in-point, as in a still
  stretch of a variable-rate screen recording, is not found, and the clip
  starts on the frame after it.
- **The picture under an overlay is not converted.** Media overlays, text
  rasters and stickers are drawn onto the joined picture as it is (yuv420p);
  only the layer is converted. Pixels under a layer with a blend mode other
  than `normal` go through RGB for the blend, with exact rounding. Up to
  2026.11.10.2 one overlay anywhere sent every frame of the export through
  RGBA and back, which lowered the picture's luma by 1.2–1.6 levels (8-bit)
  in the export this was measured on.
- **One colour description.** A native export (MP4 or MOV) is BT.709,
  limited range, 8-bit 4:2:0, and says so in the file and on every frame, as
  the in-browser export does. A source, on the main track or as an overlay,
  is read as the editor reads it:
  - by its own tags (BT.601, BT.709, limited or full range);
  - a file that says nothing as BT.601 if it has fewer than 720 lines and
    BT.709 from 720 up, limited range (Chromium's rule, so also the
    preview's);
  - a PNG or JPEG still as the picture it is.

  A BT.709 clip passes through untouched. Anything else is converted: its
  matrix and its range, while primaries and transfer are relabelled, which
  is all the in-browser export does too. Up to 2026.11.10.2 the native
  export kept each clip's own description, and wrote a still, and a
  recording with a drawn cursor, as BT.601 with no tags at all: one file
  changed description from clip to clip under its first clip's tags, a
  player showed the others up to 40 levels (8-bit) off on saturated colours,
  and overlays that appeared after such a change started 2–5 frames into
  themselves. An untagged file whose coding does not match its size (HD
  coded BT.601, SD coded BT.709) comes out shifted, as it also shows in the
  preview: tag the file. An HDR source (PQ or HLG) is not tone-mapped; it
  passes as it is, tags included, as before, and a timeline that mixes one
  with SDR clips still changes description where they meet.

### What the export checks itself

A native export counts what it wrote and says so in the job's `warnings`
(the job is still `completed`; the file is there to look at):

| Warning starts | Meaning |
|----------------|---------|
| `The joined picture is N frames (…); the timeline gives it M frames` | The main track's picture came out another length than the timeline, so picture and sound are that far apart by the end. A second warning names the clips or gaps that were written another length than planned |
| `The exported picture is N frames (…); it should be M frames` | A pass after the join (overlays, captions, the mix) added or dropped frames |
| `FFmpeg rebuilt a filter graph while it read <file> with K other input(s)` | An input changed its picture or sound format part-way through a pass that reads several inputs; what is drawn or mixed over it can start a few frames into itself from that point |
| `The exported picture is tagged …; it should be tv, bt709, bt709, bt709` | The finished file does not say it is BT.709, limited range: a pass lost or changed the colour description, and a player may show its colours shifted (not checked when the timeline has an HDR clip) |

None of them is expected: each names a fault in the export, not in the
timeline. Report it with the job's `warnings` and, if it can be run again,
`--keep-temp`.

### Keeping the intermediate files

`--keep-temp` (`keepTemp: true` in the HTTP request; native exports only)
keeps what an export normally removes when it ends. The finished job reports
the folder as `intermediates`:

```json
{ "status": "completed", "outputPath": "…/开场_查.mp4", "intermediates": "/var/folders/…/T/qcut-claude-export-Ab12Cd" }
```

| In the folder | What it is |
|---------------|------------|
| `ffmpeg-commands.sh` | Every FFmpeg command of the export, whole, in the order they ran, quoted for a shell; any step can be run again as it is |
| `segment-*.mov`, `gap-*.mov` | One file per main-track clip and per gap, picture and PCM sound, cut to the frames and samples of its span |
| `concat-video-list.txt`, `concat-audio-list.txt` | The lists that join them, each giving every file its own stream's length |
| `intermediate.mp4` (or `.mov`) | The picture as the last pass left it, when the export has passes after the join |
| `video-before-media-overlays.mp4`, `concat-before-text.mp4`, `video-before-audio-mix.mp4`, … | The picture as it was before each later pass, named for the pass |
| `mixed-master.wav` | The mix before limiting and encoding |

The folder holds full-size video and PCM, so it is large; delete it when
done. `QCUT_EXPORT_KEEP_TEMP=1` in QCut's environment keeps the files of
every export in the same way. Without either, `main.log` still has the whole
command of the media overlay pass (`Drawing 21 media overlay(s): ffmpeg …`),
inputs included.

### Enhancement flags

| Flag | Type | Description |
|------|------|-------------|
| `--cursor-sway` | number (0-2) | Spring-smoothed cursor wobble intensity |
| `--cursor-blur` | number (0-1) | Cursor motion blur ghost trail |
| `--cursor-loop` | boolean | Seamless cursor return for loop exports |
| `--auto-zoom` | boolean | Auto-generate zoom regions from cursor clicks/dwells |
| `--zoom-blur` | number (0-1) | Motion blur during zoom transitions |
| `--gif-fps` | number | GIF frame rate (15, 20, 25, 30) |
| `--gif-loop` | boolean | GIF infinite loop |
| `--gif-quality` | number (1-20) | GIF quality (lower = better visual, slower) |
| `--mic` | boolean | Capture microphone audio |
| `--system-audio` | boolean | Capture system audio |
| `--peak-correction` | `local` \| `whole` \| `check` | Native exports with the master limiter on: how encoding peaks over the ceiling are handled (see [Native export true-peak limiting](#native-export-true-peak-limiting)) |

### Job management

```bash
qcut editor:export:status --project-id <id> --job-id <id>
qcut editor:export:list-jobs --project-id <id>
qcut editor:export:cancel --project-id <id> --job-id <id>   # stops a native export; partial output removed
```

`--poll --json` keeps stdout to one JSON document, the final result; the
`{"status":"pending","jobId":…}` line that announces the job goes to stderr,
as does any progress. When a poll runs out of time the export goes on in
QCut: `export status` follows it, `export cancel` stops it. A cancelled job
ends with `status: "cancelled"` and no file at the output path. Exports that
run in the editor window (the muxer engine) cannot be cancelled from the CLI.

### Native export true-peak limiting

When the master limiter is enabled, native MP4, MOV and MP3 exports apply a
four-times oversampled limiter and measure the final encoded file before the
job becomes `completed`. Enable the master limiter through the mixer (see
[editor-mix.md](editor-mix.md)); no separate export flag is required.

Each candidate is encoded from the same lossless mixed audio. If AAC/MP3
encoding pushes the true peak over the ceiling, what happens depends on
`--peak-correction` (`peakCorrection` in the HTTP request; native exports
only):

- `local` (default): QCut lowers only the moments around the overshoot and
  re-encodes, up to six attempts: every 100 ms block whose true peak is
  within 0.75 dB of the ceiling comes down to 1.25 dB under it (with one
  codec window either side, easing in and out over 20 ms), because encoding
  again moves each block's peak by a few tenths of a dB. The rest of the mix
  keeps its level, so a change elsewhere, a picture-only edit for example,
  does not move the level of the whole export. The loud moments it lowers
  come down relative to the rest, so the loudness range shrinks a little.
- `whole`: the whole mix comes down by the overshoot plus 0.3 dB and is
  encoded again (QCut before 2026.10.29.3). Level relationships stay as
  mixed, but the whole export's level follows the encoder's worst moment,
  so a small change anywhere can move it by tenths of a dB.
- `check`: nothing is lowered. The first encode is published as it is and
  `audioValidation.status` is `exceeded` (with a warning) when it went over.

Only a verified candidate replaces the destination file (`check` publishes
its single encode). The meter's 0.1 dB display precision is handled
conservatively; a displayed peak exactly at the ceiling is not accepted
without additional headroom. `editor mix loudness` (native) shows which
stretches an export with the default `local` correction would lower, before
you export (see [editor-mix.md](editor-mix.md)). Its measuring render always
corrects locally: an export with `whole` lowers the whole mix instead, and
one with `check` lowers nothing.

`export:status` and the final `--poll` result include `audioValidation` in both
plain and JSON output. For example:

```json
{
  "status": "passed",
  "ceilingDbtp": -1,
  "truePeakDbtp": -1.1,
  "limiting": {
    "oversampleFactor": 4,
    "encodeAttempts": 2,
    "peakCorrection": "local",
    "correctedSeconds": 0.47,
    "maxCorrectionDb": 2.25,
    "corrections": [
      { "start": 12.332, "end": 12.568, "depthDb": 2.25 },
      { "start": 87.132, "end": 87.368, "depthDb": 1.85 }
    ]
  }
}
```

`corrections` lists each stretch that was lowered, in seconds from the start
of the export, from where the level starts to ease down to where it is back
(its 20 ms ramps included), with how far it came down at its deepest
(`depthDb`; stretches whose ramps touch are one entry). `correctedSeconds` is
their total length and `maxCorrectionDb` the deepest of them; all are empty or 0 when
the first encode passed or with `check`. With `whole`, `corrections` is one
stretch covering the whole export. Earlier versions reported the whole-mix
reduction as `attenuationDb`.

Digital silence passes with `truePeakDbtp: null`. Video without an audio stream
returns `status: "no-audio"`; MP3 without audio fails.

If measurement fails or no candidate meets the ceiling, the job fails instead
of publishing an unverified result. Cancellation stops processing and removes
this job's unfinished output; a pre-existing destination is retained until a
verified replacement is published. With the master limiter disabled, this
processing and `audioValidation` are absent. GIF has no audio processing.

This guarantee applies to the final native export. Live preview and renderer
muxer exports retain their existing dynamics processing; heavy limiting or
encoding correction can change the final audio level relative to preview.

---

## Diagnostics Commands

```bash
qcut editor:diagnostics:analyze \
  --message "Canvas rendering failed" \
  --stack "Error at line 42 in renderer.ts"

# With context
qcut editor:diagnostics:analyze \
  --message "Export stalled at 50%" \
  --data '{"exportFormat":"mp4","resolution":"4k"}'
```

---

## MCP Commands

```bash
# Inline HTML
qcut editor:mcp:forward-html \
  --html "<h1>Hello World</h1>"

# From file
qcut editor:mcp:forward-html \
  --html @preview.html --tool-name "my-mcp-tool"
```

---

## Screen Recording Commands

> **Auto-spawn behaviour (Phase 2 dual-mode recording):** every
> `editor:screen-recording:*` command auto-launches a hidden headless
> QCut if the editor app isn't already running. You do not need to
> start QCut manually. Pass `--no-auto-launch` to opt out and get the
> old "Cannot connect to QCut" error instead.
>
> For a one-shot command that doesn't need the editor UI at all, use
> `qcut record` (see the "Standalone Recording" section below).

### List capture sources

```bash
qcut editor:screen-recording:sources
```

### Start recording

```bash
# Record default screen
qcut editor:screen-recording:start --project-id <id>

# Record specific source
qcut editor:screen-recording:start \
  --project-id <id> --source-id "screen:2:0" --filename my-recording

# Force-stop existing session first
qcut editor:screen-recording:start --project-id <id> --force
```

### Stop recording

```bash
qcut editor:screen-recording:stop --project-id <id>
qcut editor:screen-recording:stop --project-id <id> --discard
```

### Force-stop (emergency)

```bash
qcut editor:screen-recording:force-stop --project-id <id> --force
```

### Get recording status

```bash
qcut editor:screen-recording:status --project-id <id>
```

### Record → Enhance → Export workflow

```bash
PROJECT=<project-id>

# 1. List sources
qcut editor:screen-recording:sources

# 2. Record
qcut editor:screen-recording:start \
  --project-id $PROJECT --source-id "screen:2:0" --filename demo

# ... do your demo ...

# 3. Stop
qcut editor:screen-recording:stop --project-id $PROJECT

# 4. Import into project
qcut editor:media:import \
  --project-id $PROJECT --source ~/Movies/QCut\ Recordings/demo.mp4

# 5. Add to timeline
qcut editor:timeline:add-element \
  --project-id $PROJECT --data '{"type":"video","mediaId":"<media-id>","startTime":0}'

# 6. Export with enhancements
qcut editor:export:start \
  --project-id $PROJECT --preset youtube-1080p \
  --cursor-sway 1.0 --cursor-blur 0.3 --auto-zoom --poll
```

Recordings save to `~/Movies/QCut Recordings/` with a `.cursor.json` telemetry sidecar for cursor position tracking. The `--auto-zoom` flag uses this telemetry to generate zoom regions from click clusters and cursor dwell areas.

### Standalone recording — `qcut record` (no editor needed)

`qcut record` spawns its own hidden QCut instance, captures for a fixed
duration, writes an MP4, and exits. Ideal for scripts and CI jobs where
opening the editor UI is overkill.

```bash
# Record primary screen for 10 seconds
qcut record --record-duration 10 -o demo.mp4

# Pick a source (use editor:screen-recording:sources to discover IDs)
qcut record --source "screen:0:0" --record-duration 15 -o demo.mp4

# Interactive — press Ctrl-C to stop
qcut record -o long-demo.mp4
```

| Flag | Description |
|------|-------------|
| `--record-duration` | Auto-stop after N seconds (omit for Ctrl-C mode) |
| `--source` | Capture source ID (default: primary screen) |
| `--output`, `-o` | Output file name (default: `recording-<ts>.mp4`) |
| `--cursor-sway` | Cursor wobble 0–2 (export compositor) |
| `--cursor-loop` | Smooth loop return for cursor path |
| `--zoom-blur` | Motion blur during zoom transitions 0–1 |
| `--mic` | Capture microphone audio |
| `--system-audio` | Capture system audio (default: true) |
| `--no-auto-launch` | Fail if no headless recorder can be spawned |

### Daemon management — `qcut record-daemon`

When `editor:screen-recording:*` auto-spawns a headless recorder, it
stays alive for 30s of inactivity to amortise cold-start across
subsequent CLI calls. Manual control is rarely needed but available:

```bash
qcut record-daemon             # --status (default): print pid + port
qcut record-daemon --stop      # SIGTERM the running daemon
qcut record-daemon --start     # Spawn a daemon explicitly (no-op if one is running)
```

State files: `~/.qcut/.headless-record.pid` and `~/.qcut/.headless-record.port`.

See `docs/task/recordly/22-cli-standalone-phase1-record-command.md`
and `docs/task/recordly/23-cli-standalone-phase2-editor-commands.md`
for architecture details.

---

## UI Commands

### Switch editor panel

```bash
qcut editor:ui:switch-panel --panel media
```

Available left panels: `media`, `text`, `audio`, `mixer`, `stickers`, `video-edit`, `effects`, `transitions`, `filters`, `text2image`, `nano-edit`, `ai`, `sounds`, `segmentation`, `remotion`, `pty`, `word-timeline`, `project-folder`, `upscale`, `moyin`

### Switch properties panel tab

```bash
qcut editor:ui:switch-panel --panel export
qcut editor:ui:switch-panel --panel api-keys
qcut editor:ui:switch-panel --panel properties
```

Available properties sub-tabs: `properties`, `export`, `api-keys`

---

## Moyin Script Direction Commands

### Set script

```bash
qcut editor:moyin:set-script --text "Scene 1: A dark room..."
qcut editor:moyin:set-script --script @screenplay.txt
```

### Parse script

```bash
qcut editor:moyin:parse
```

Triggers the "Parse Script" button in the director panel.

### Get pipeline status

```bash
qcut editor:moyin:status
```

Returns `parseStatus` and pipeline step progress.

---

## Screenshot Commands

### Capture screenshot

```bash
# Saved as ~/Movies/QCut Recordings/qcut-screenshot.png
qcut editor:screenshot:capture --filename "qcut-screenshot.png"

# Saved wherever you say (.png is added when missing)
qcut editor:screenshot:capture --output ./evidence/after-sfx.png
```

Takes a screenshot of the QCut editor window. `--filename` only names the
file inside QCut's recordings folder; `--output` moves it to the given path
and returns that path as `filePath`.

---

## State Control Commands

### Undo / Redo

```bash
qcut editor:undo --json
qcut editor:redo --json
```

Each answers with the step it took back or redid (`label`) and what that
changed (`changes`), and fails when nothing changed; see
editor-state-control.md.

### State snapshot

```bash
# Full snapshot (all sections)
qcut editor:state:snapshot --json

# Partial snapshot (specific sections)
qcut editor:state:snapshot --include timeline,playhead --json

# Include raw base64 thumbnails (off by default)
qcut editor:state:snapshot --include media --with-thumbnails --json
```

**Sections**: `timeline`, `selection`, `playhead`, `media`, `editor` (or `ui`), `project`

**Thumbnails are stripped by default.** `media.items[].url` and `media.items[].thumbnailUrl` are replaced with the sentinel `"<stripped>"` whenever the value is a `data:image/...;base64,…` URI — base64 thumbnails routinely push the response past 10–20 MB and break JSON parsing in clients. Pass `--with-thumbnails` to opt back into the raw URIs (only do this when the consumer is going to render them, e.g. a debugging UI). Non-data URIs (`blob:`, `https:`, `app:`) always pass through.

> ⚠️ **`--with-thumbnails` may return unparseable JSON.** Some renderer-stored `data:application/octet-stream;base64,…` payloads contain corruption from upstream `Blob.toString()` calls — the response can hit `Invalid control character` mid-base64. The default (stripped) path always parses cleanly. Don't use `--with-thumbnails` in tooling; if you actually need an image, fetch it through the dedicated thumbnail endpoint (planned).

For advanced state automation (events, transactions, capabilities, notification bridge), see [editor-state-control.md](editor-state-control.md).
