# QCut Editor CLI — Timeline & Editing Commands

See [editor-core.md](editor-core.md) for connection options, flags, and workflows.

---

## Timeline Commands

### Export timeline

```bash
qcut editor:timeline:export --project-id <id>
qcut editor:timeline:export --project-id <id> --json
qcut editor:timeline:export --project-id <id> --output-format json
```

### Import timeline

```bash
qcut editor:timeline:import \
  --project-id <id> \
  --data '{"name":"My Timeline","tracks":[{"id":"t1","type":"video","elements":[]}]}'

# From file / replace existing
qcut editor:timeline:import --project-id <id> --data @timeline.json --replace
```

**Notes**: Track `index` is optional (auto-assigned). Use `sourceName` (filename) in element data, not `mediaId`.

### Add element

```bash
# Media element (use sourceName to link to imported media)
qcut editor:timeline:add-element \
  --project-id <id> \
  --data '{"type":"video","sourceName":"my-video.mp4","startTime":0,"duration":10,"trackId":"track-1"}'

# Audio file: use "type":"audio"; it lands on an audio track
qcut editor:timeline:add-element \
  --project-id <id> \
  --data '{"type":"audio","sourceName":"door-creak.wav","startTime":12}'

# Text element
qcut editor:timeline:add-element \
  --project-id <id> \
  --data '{"type":"text","content":"Hello World","startTime":0,"duration":5}'
```

Video and audio given without `duration` take their file's own length: for
video, the length of the video stream, not the container (which can be a
little longer because of the audio track). If QCut cannot read the file's
length yet, the add fails and asks for `duration` instead of guessing.

### Batch add elements (max 50)

Each element **must** include `trackId`, a start and a length (see placement
below).

```bash
qcut editor:timeline:batch-add \
  --project-id <id> \
  --elements '[{"type":"text","content":"Title","startTime":0,"duration":3,"trackId":"track-1"},{"type":"text","content":"End","startTime":10,"duration":3,"trackId":"track-1"}]'
```

### Placing elements without adding up seconds

`add-element` and `batch-add` accept these instead of seconds:

| Field | Meaning |
|-------|---------|
| `"startTime": "end"` | Start where the last element on `trackId` ends |
| `"after": "<elementId>"` | Start where that element ends, on its track unless `trackId` names another |
| `"startFrame": <n>` | Start at whole frame `n` of the project frame rate |
| `"durationFrames": <n>` | Last `n` whole frames |

Give one start (`startTime`, `after` or `startFrame`) and one length
(`duration` or `durationFrames`, or neither for video/audio). In a batch,
`"end"` sees the elements added earlier in the same batch, so this lays clips
end to end:

```bash
qcut editor:timeline:batch-add \
  --project-id <id> \
  --elements '[
    {"type":"media","sourceName":"01.mp4","trackId":"<main-track>","startTime":"end"},
    {"type":"media","sourceName":"02.mp4","trackId":"<main-track>","startTime":"end"},
    {"type":"media","sourceName":"03.mp4","trackId":"<main-track>","startTime":"end"}
  ]'
```

To import files and lay them out in one step, use
`editor:media:batch-import --append-to-track <track-id>` (see
[editor-media.md](editor-media.md)).

### When a placement is refused

A track plays one element at a time. Clips that touch are fine, including
seams that miss by floating-point rounding (anything under half a frame
counts as touching). An add, update or move onto an occupied span fails and
says which clip is in the way and the next start where the element fits:

```text
117.25s–133.291667s on track "Main" overlaps "07.mp4" (117.3s–121.3s). A track
plays one element at a time; the next free start for this 16.041667s clip is
140s.
```

A locked track says so instead. Pass `"collision":"insert"` or
`"collision":"overwrite"` on an add to make room rather than fail.

### Update element

```bash
qcut editor:timeline:update-element \
  --project-id <id> \
  --element-id <id> \
  --changes '{"startTime":5,"duration":15}'
```

### Volume over time (media clips)

`audio` on a media element merges into its audio settings, the same ones the
editor's audio panel edits. `audio.keyframes.volumeDb` replaces the clip's
volume keyframes; `[]` or `null` removes them. Each keyframe is
`{frame, value, easing?}`:

- `frame`: whole frames at the project frame rate, counted from the clip's
  start on the timeline (not the source file).
- `value`: level in dB, clamped to -60..12. 0 leaves the clip unchanged.
- `easing`: `linear` (default), `easeIn`, `easeOut`, `easeInOut`, or `spring`.

Before the first keyframe and after the last, the level holds. Keyframes are
the clip's whole level, so they take over from a fixed `volume`.

```bash
# Duck music under a voice at 30 fps: down to -18 dB by 1 s, hold until 5 s,
# back to 0 dB at 6 s.
qcut editor:timeline:update-element \
  --project-id <id> \
  --element-id <music-element-id> \
  --changes '{"audio":{"keyframes":{"volumeDb":[{"frame":0,"value":0},{"frame":30,"value":-18},{"frame":150,"value":-18},{"frame":180,"value":0}]}}}'
```

Malformed audio (a fractional frame, an unknown keyframe property, a missing
value) fails the update with the reason, and nothing about the element
changes. `batch-add` accepts the same `audio` object on media elements.

### Batch update elements (max 50)

```bash
qcut editor:timeline:batch-update \
  --project-id <id> \
  --updates '[{"elementId":"e1","changes":{"startTime":0}},{"elementId":"e2","changes":{"startTime":10}}]'
```

Each item reports whether it applied. An item whose new `startTime` is
refused (occupied span, locked track) fails with the reason, and none of its
other changes are applied.

### Clip colours

Clips can carry a `colorLabel`: `violet`, `blue`, `green`, `yellow`, `red`,
`rose`, `orange` or `mango`. Any other value fails and lists these. Set it on
any clip with `update-element` or `batch-update`, or on media clips when adding
them (`add-element`, `batch-add`):

```bash
qcut editor:timeline:update-element --project-id <id> --element-id <id> \
  --changes '{"colorLabel":"red"}'

qcut editor:timeline:batch-add --project-id <id> \
  --elements '[{"type":"audio","sourceName":"shot.wav","trackId":"<id>","startTime":"end","colorLabel":"red"}]'
```

To colour many clips at once, `color-label` colours every clip on a track, or
listed clips, in one step and reports what it changed (`updatedCount`) and what
it could not (`skipped`, with a reason such as a locked track):

```bash
qcut editor:timeline:color-label --project-id <id> --track-id <id> --color red
qcut editor:timeline:color-label --project-id <id> --element-ids '["a","b"]' --color green
qcut editor:timeline:color-label --project-id <id> --track-id <id> --clear
```

A track can also have a default colour (`editor track update --color`, see
[editor-tracks-stickers-search.md](editor-tracks-stickers-search.md)); clips
without their own colour show it.

### Delete element

```bash
qcut editor:timeline:delete-element \
  --project-id <id> \
  --element-id <id>
```

### Batch delete elements (max 50)

```bash
# Simple: plain element ID array
qcut editor:timeline:batch-delete \
  --project-id <id> \
  --cuts '["elem1","elem2","elem3"]' \
  --ripple

# Explicit: with trackId per element
qcut editor:timeline:batch-delete \
  --project-id <id> \
  --cuts '[{"trackId":"t1","elementId":"elem1"}]' \
  --ripple
```

### Split element

```bash
qcut editor:timeline:split \
  --project-id <id> \
  --element-id <id> \
  --split-time 10
```

### Split a clip by its shots

The same action as the timeline's right-click "智能镜头分割": detect shot
boundaries in the clip's source, snap them to frames, and cut the clip at each
one as a single undo step (Cmd+Z in the editor reverts the whole split). It is
a job: the command waits (`--timeout`, default 600 s) and prints the result;
`--no-wait` returns the job id and `editor timeline job-status` follows it.

```bash
# Plan only: which cuts the engine would make, nothing changes
qcut editor timeline shot-split --project-id <id> --element-id <id> --dry-run --json
# Cut, with the best engine available (auto = jianying, then onnx, then ffmpeg)
qcut editor timeline shot-split --project-id <id> --element-id <id> --json
# A specific engine; ffmpeg takes --threshold
qcut editor timeline shot-split --project-id <id> --element-id <id> --engine ffmpeg --threshold 0.3 --json
# Given cut points (source seconds), no detection: detect, review, then cut
qcut editor timeline shot-split --project-id <id> --element-id <id> --cuts 3.333,15.167 --json
qcut editor timeline shot-split --project-id <id> --element-id <id> --cuts @shots.json --json
# Every video clip on a track, keeping shots of at least a second
qcut editor timeline shot-split --project-id <id> --track-id <id> --min-shot 1 --json
```

The result lists, per clip: `requestedEngine` and the `engine` that ran (with
`fallbacks` naming the engines `auto` passed over and why), `cuts` as
`{sourceTime, timelineTime}` pairs, `skipped` boundaries with the reason
(outside the trimmed range, within a frame of an edge or of another cut,
would leave a shot shorter than `--min-shot`, refused by the editor), the
`createdElementIds` and `elementIds` in time order. `--cuts` accepts a
comma-separated list, or `@file.json` holding an array of seconds, an
`analyze shots` result or an `analyze scenes` result. After a split,
`timeline export` shows the new clips. Which engines this machine can run:
`qcut editor analyze engines --json`.

### Move element

Give `--time`, `--to-track`, or both. Without `--to-track` the element stays
on its track; without `--time` it keeps its start on the new track.

```bash
# Along its own track
qcut editor:timeline:move \
  --project-id <id> \
  --element-id <id> \
  --time 15.0

# To another track, same start
qcut editor:timeline:move \
  --project-id <id> \
  --element-id <id> \
  --to-track <track-id>
```

### Arrange elements on a track

```bash
# Sequential (end-to-end, no gaps)
qcut editor:timeline:arrange \
  --project-id <id> --track-id <id> --mode sequential

# Spaced (with gap)
qcut editor:timeline:arrange \
  --project-id <id> --track-id <id> --mode spaced --gap 2.0

# Manual order
qcut editor:timeline:arrange \
  --project-id <id> --track-id <id> --mode manual \
  --data '["elem3","elem1","elem2"]' --start-time 0
```

### Selection

```bash
qcut editor:timeline:select \
  --project-id <id> \
  --elements '[{"trackId":"t1","elementId":"e1"}]'

# Every clip showing a colour (its own, or its track's), like "Select same
# colour" in the clip menu; returns the selected clips
qcut editor:timeline:select --project-id <id> --color green

qcut editor:timeline:get-selection --project-id <id>
qcut editor:timeline:clear-selection --project-id <id>
```

### Get timeline info

```bash
qcut editor:timeline:info --project-id <id> --json
```

Returns timeline state: tracks, elements, duration, playhead position.

### Add media clip to timeline

```bash
qcut editor:timeline:add-clip --project-id <id> --media-id <media-id>
qcut editor:timeline:add-clip --project-id <id> --media-id <media-id> --track-id <track-id> --start-time 5.0
```

| Flag | Type | Description |
|------|------|-------------|
| `--project-id` | string | Project ID (required) |
| `--media-id` | string | Media ID to add (required) |
| `--track-id` | string | Target track ID |
| `--start-time` | number | Start position in seconds |

### Trim element

```bash
qcut editor:timeline:trim --project-id <id> --element-id <eid> --start-time 2.0 --end-time 8.0
```

| Flag | Type | Description |
|------|------|-------------|
| `--project-id` | string | Project ID (required) |
| `--element-id` | string | Element ID (required) |
| `--start-time` | number | New start time in seconds (required) |
| `--end-time` | number | New end time in seconds (required) |

### Playback controls

```bash
qcut editor:timeline:play --project-id <id>
qcut editor:timeline:pause --project-id <id>
qcut editor:timeline:toggle-play --project-id <id>
qcut editor:timeline:seek --project-id <id> --time 15.0
```

---

## Editing Commands

### Batch cuts

```bash
qcut editor:editing:batch-cuts \
  --project-id <id> \
  --element-id <id> \
  --cuts '[{"start":2,"end":4},{"start":8,"end":10}]' \
  --ripple
```

### Delete time range

```bash
qcut editor:editing:delete-range \
  --project-id <id> \
  --start-time 5.0 \
  --end-time 15.0 \
  --ripple

# Limit to specific tracks
qcut editor:editing:delete-range \
  --project-id <id> \
  --start-time 5.0 --end-time 15.0 \
  --track-id "track-1,track-2" \
  --cross-track-ripple
```

### Auto-edit (remove fillers/silences)

```bash
# Synchronous
qcut editor:editing:auto-edit \
  --project-id <id> --element-id <id> --media-id <id> \
  --remove-fillers --remove-silences --threshold 0.5

# Async with polling
qcut editor:editing:auto-edit \
  --project-id <id> --element-id <id> --media-id <id> \
  --remove-fillers --poll --poll-interval 2

# Dry run
qcut editor:editing:auto-edit \
  --project-id <id> --element-id <id> --media-id <id> \
  --remove-silences --dry-run
```

### Auto-edit job management

```bash
qcut editor:editing:auto-edit-status --project-id <id> --job-id <id>
qcut editor:editing:auto-edit-list --project-id <id>
```

### AI-suggested cuts

```bash
qcut editor:editing:suggest-cuts \
  --project-id <id> --media-id <id> \
  --include-fillers --include-silences --include-scenes

# Async with polling
qcut editor:editing:suggest-cuts \
  --project-id <id> --media-id <id> --poll --timeout 120

qcut editor:editing:suggest-status --project-id <id> --job-id <id>
```
