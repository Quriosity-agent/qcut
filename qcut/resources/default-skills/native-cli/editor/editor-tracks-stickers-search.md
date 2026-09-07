# QCut Editor CLI — Tracks, Elements, Stickers, Search, and Input Helpers

Editor commands that were added after the original editor reference files.
The `editor` commands need a running QCut editor and accept `--project-id`
(defaulting to the active project where noted); the standalone commands called
out below (sticker search and reference tooling) run without one. Use either spelling:

```bash
qcut editor track list --project-id <id> --json      # group syntax
qcut editor:track:list --project-id <id> --json      # legacy colon form
```

Confirm flags with `qcut editor <area> <action> --help --json`.

## Tracks

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor track list` | — | `--project-id` | List timeline tracks in visual order |
| `editor track create` | `--type` | `--project-id`, `--name`, `--index` | Create a track (`media`, `text`, `audio`, `sticker`, …) |
| `editor track update` | `--track-id` | `--project-id`, `--name`, `--index` | Rename or move a track |
| `editor track move` | `--track-id --index` | `--project-id` | Move a track to an exact visual index |
| `editor track delete` | `--track-id` | `--project-id`, `--force`, `--ripple` | Delete a track; `--force` for non-empty tracks |

```bash
qcut editor track list --project-id <id> --json
qcut editor track create --type text --name "Captions" --project-id <id> --json
qcut editor track delete --track-id <track-id> --force --project-id <id> --json
```

## Element patch and timeline manifests

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor element patch` | `--element-id --set` | `--project-id` | Patch any timeline element fields (`--set '{"opacity":0.5}'` or `--set @patch.json`) |
| `editor timeline apply` | `--manifest` | `--project-id`, `--replace`, `--atomic`, `--verify` | Apply a complete timeline manifest atomically |

```bash
qcut editor element patch --element-id <id> --set '{"name":"Intro"}' --project-id <id> --json
qcut editor timeline apply --manifest @timeline.json --replace --atomic --verify --project-id <id> --json
```

`timeline apply --replace` overwrites the whole timeline. Export the current
timeline first (`editor timeline export`) so the change can be reverted.

## Stickers

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor sticker search` | `--query` | `--collection`, `--limit` | Search the Iconify sticker catalog |
| `editor sticker add` | `--project-id --end-time` | `--sticker-id`, `--provider`, `--batch-id`, `--root`, `--source`, `--x`, `--y`, `--start-time`, `--width`, `--height`, `--rotation`, `--opacity` | Add a sticker at a position and time |
| `editor sticker update` | `--project-id --element-id` | `--source`, `--sticker-id`, `--x`, `--y`, `--start-time`, `--end-time`, `--width`, `--height`, `--rotation`, `--opacity` | Update position, size, time, or image |
| `editor sticker remove` | `--project-id --element-id` | — | Remove a sticker |
| `editor sticker list` | `--project-id` | — | List all stickers on the timeline |

```bash
qcut editor sticker search --query detective --limit 12 --json
qcut editor sticker add --project-id <id> --sticker-id fluent-emoji:fire --x 860 --y 440 --start-time 2 --end-time 5 --width 200 --json
qcut editor sticker list --project-id <id> --json
```

`--sticker-id` takes an Iconify id such as `fluent-emoji:fire`. `--source`
takes a local image path. Sticker Lab references use `--provider`,
`--batch-id`, and `--root` (see
[reference-labs-compose.md](../references/reference-labs-compose.md#sticker-lab--private-sticker-reference-batches)).
The standalone `edit sticker-overlay` command renders stickers into a video
file without an editor.

## Transcript search

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor search query` | `--project-id --query` | `--case-sensitive`, `--whole-word`, `--max-results`, `--media-id` | Search transcriptions by text |
| `editor search status` | `--project-id` | — | List transcription status for all media in a project |
| `editor search index` | `--project-id` | `--media-id` | Trigger transcription for untranscribed media |

```bash
qcut editor search status --project-id <id> --json
qcut editor search index --project-id <id> --json
qcut editor search query --project-id <id> --query "hello world" --json
```

## Audio and caption export

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor export audio` | `--project-id` | `--poll`, `--filename`, `--bitrate`, `--sample-rate` | Export the timeline audio mix as MP3 |
| `editor export captions` | `--project-id` | `--filename`, `--format` | Export timeline captions as a sidecar file |

Video export is `editor export start`; see
[editor-output.md](editor-output.md).

## Project and transition helpers

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor project reveal` | — | `--project-id` | Reveal the project folder in the OS file manager |
| `editor transition-lab list` | — | — | List distributable QCut shader transition recipes |
| `editor transition-lab apply` | `--preset --track-id --from-element-id --to-element-id` | `--project-id`, `--duration` | Apply a recipe between adjacent clips |
| `editor analyze beats` | `--project-id --media-id` | `--threshold` | Detect audio beats and BPM |

## Script Director (Moyin) and novel parsing

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor moyin set-script` | — | `--text`, `--script` | Push script text to the director panel |
| `editor moyin parse` | — | `--model` | Trigger the Parse Script button |
| `editor moyin status` | — | — | Get pipeline progress |
| `editor moyin export` | — | `--output` | Export Script Director data as JSON |
| `editor moyin generate` | — | `--idea`, `--genre`, `--target-duration` | Generate a script from an idea |
| `editor novel parse` | `--input` | `--output`, `--language`, `--max-clips` | Parse novel text into a structured screenplay |

The standalone `moyin:parse-script` command parses a screenplay file without an
editor.

## Demo runs, keyboard, and UI waits

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor demo run` | `--plan` | `--record`, `--recording-quality`, `--event-track`, `--preroll-ms`, `--postroll-ms`, `--speed`, `--skip-idle`, `--project-id`, `--timeout-ms` | Prepare, record, export, and verify an editor demo from one plan |
| `editor keyboard press` | `--keys` | `--interval-ms`, `--foreground` | Press a comma-separated key or shortcut sequence |
| `editor keyboard type` | `--text` | `--interval-ms`, `--key-events`, `--foreground` | Type into the focused control; `--key-events` sends keyDown/keyUp per character so keydown handlers fire (default inserts text) |
| `editor ui wait` | — | `--ref`, `--text`, `--value`, `--timeout-ms`, `--interval-ms` | Wait until visible UI state matches a ref, text, or value |
| `editor ui context-menu` | `--element-id` | `--verbose` | Dispatch a right-click context menu on a timeline element (debug) |
| `editor screen-recording diagnose` | — | — | Diagnose recording permission and capture sources |

```bash
qcut editor demo run --plan promo.json --record demo.mp4 --speed 1.5 --skip-idle --force --json
qcut editor keyboard press --keys "cmd+s" --force --json
qcut editor ui wait --text "Auto-saved" --timeout-ms 5000 --json
```

## Pointer automation

Pointer commands drive a visible Agent pointer with real Electron input events.
Targets come from accessibility snapshots (`editor snapshot`, see
[editor-agent.md](editor-agent.md)) as `--ref @e12`, from semantic
`--target` names, or from `--x/--y` and `--normalized-x/--normalized-y`
coordinates. The pointer-input commands (`move`, `hover`, `click`,
`double-click`, `right-click`, `drag`, `scroll`, `drop-files`) accept
`--modifiers` with a comma-separated list of `alt`, `ctrl`, `cmd` (meta), and
`shift`; the timeline treats a
modifier-click as multi-select and ctrl/cmd + wheel as zoom.

Clicks, drags, sequences, keyboard input, snapshot `select`/`check`, and
`demo run` are in the action policy's confirm tier: interactive sessions get a
prompt, non-interactive ones need `--force` or a `--policy` file. `move`,
`hover`, `scroll`, `wait-for`, `state`, and `hit-test` run without
confirmation.

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor pointer move` | — | `--target`, `--ref`, `--x`, `--y`, `--wait-for`, `--speed`, `--foreground` | Move the pointer without activating QCut |
| `editor pointer hover` | — | same as `move` | Move and settle long enough to trigger hover UI |
| `editor pointer click` | — | same as `move`, plus `--button left\|middle\|right`, `--click-count 1..3` | Click with real mouseDown and mouseUp events; 3 press cycles select a paragraph |
| `editor pointer double-click` | — | same as `move` | Double-click |
| `editor pointer right-click` | — | same as `move` | Open a context menu with a real right-click |
| `editor pointer drag` | — | `--from/--to` (semantic targets), `--from-ref/--to-ref` (snapshot refs), `--from-x/--from-y/--to-x/--to-y`, `--to-time`, `--seek-mode drag\|api`, `--to-index`, `--via`, `--hold-ms`, `--duration-ms`, `--steps`, `--verify`, `--dnd auto\|html5\|mouse`, `--drag-start-timeout-ms`, `--button` | Drag between refs or coordinates; HTML5 drag sources are intercepted and dropped; `--from timeline.playhead --to-time N` scrubs the playhead |
| `editor pointer scroll` | — | `--delta-x`, `--delta-y`, plus targeting flags | Scroll at the pointer, a ref, or a coordinate |
| `editor pointer wait-for` | — | `--target`, `--text`, `--timeout-ms`, `--interval-ms` | Wait for a semantic target or visible text |
| `editor pointer hide` | — | — | Hide the Agent pointer overlay |
| `editor pointer state` | — | — | Read the overlay state: position, action, pressed button, input mode |
| `editor pointer hit-test` | — | `--target`, `--ref`, `--x/--y`, `--normalized-x/--normalized-y` | Report the element under a point without input: tag, role, name, test id, ref, bounds, ancestor test ids |
| `editor pointer drop-files` | `--files a.mp4,b.png` | targeting flags, `--modifiers`, `--wait-for` | Drop local files on a target as an external HTML5 file drop (media library import, file drop zones); background input only |
| `editor windows` | — | — | List open QCut windows (id, title, focused, visible, bounds, `main`) for `--window-id` |
| `editor pointer sequence` | `--actions` | `--record`, `--recording-quality`, `--event-track`, `--speed`, `--skip-idle`, `--foreground` | Run pointer, keyboard, wait, and snapshot actions from one JSON file |

```bash
qcut editor snapshot --interactive --json
qcut editor pointer click --ref @e12 --force --json
qcut editor pointer drag --from-ref @e12 --to-ref @e27 --force --json
qcut editor pointer drag --from testid:media-item --to testid:timeline-track --dnd html5 --force --json
qcut editor pointer click --ref @e12 --modifiers shift --force --json          # add to the selection
qcut editor pointer scroll --target timeline.toolbar --delta-y -120 --modifiers ctrl --json   # zoom the timeline
qcut editor pointer hit-test --x 388 --y 879 --json                            # what is under that point?
qcut editor pointer drop-files --files ./clip.mp4 --target panel.media --force --json   # import by dropping
qcut editor keyboard type --text "Intro" --key-events --force --json           # real key events
qcut editor pointer sequence --actions @demo-actions.json --record demo.mp4 --force --json
```

### HTML5 drag-and-drop

Media, text, effect, transition, and sound panel items are HTML5 drag sources,
and the timeline tracks only accept drops through `dataTransfer`. A plain
mouse drag cannot place them. In background mode `pointer drag` enables CDP
drag interception before pressing: when the page starts a drag, the pointer
captures its payload and replays it as `dragEnter` → `dragOver` → `drop` at
the destination, then releases the button.

- `--dnd auto` (default): intercept when the page starts a drag, otherwise
  finish as a mouse drag. Timeline clips still move with mouse events.
- `--dnd html5`: require an intercepted drag; fails with 409 when the source
  is not draggable. Needs `state.pointer` 1.2.0 and background input.
- `--dnd mouse`: never intercept (the pre-1.2.0 behavior).
- `--via` waypoints accept the same spellings as `--from`/`--to`: semantic
  targets, refs, viewport coordinates, or normalized ratios.

`editor pointer drop-files` is the other direction: it dispatches
`dragEnter → dragOver → drop` with `DragData.files`, so the page receives real
`File` objects with local paths. Dropping on the media library imports the
files; the result reports `dnd.fileCount`.

Coordinates are CSS pixels of the editor page. With a page zoom other than 1
the CDP path is unaffected, foreground Electron input is scaled by the zoom,
and the viewport bound check uses the CSS viewport, so snapshot bounds and
hit-test results stay valid targets.

Session mode (`qcut --session`) accepts the same pointer flags as one-shot
commands (`--foreground`, `--dnd`, `--modifiers`, `--button`, `--click-count`,
`--via`, `--steps`, `--hold-ms`, `--no-verify`, `--key-events`, `--files`,
`--seek-mode`).

`--from timeline.playhead --to-time <seconds>` is a real scrub: the CLI reads
the ruler labels ("0s", "5s", …) through `GET /api/claude/pointer/ruler-labels`
(a renderer probe; older editors fall back to a full snapshot) to recover
pixels per second, presses the playhead, drags it to the matching x, releases,
and reports `achievedTime` from where the playhead landed. When the labels
cannot be read, or with `--seek-mode api`, it seeks through the playback API
and only animates the pointer (`method: "api-seek"`, `reason` says why,
`animation.type: "display-only"`).

`qcut editor --help` lists the editor areas (`track`, `timeline`, `pointer`, …)
with their action counts; `qcut editor <area> <action> --help --json` gives the
flags.

Every pointer, keyboard, hit-test, drop-files, and ruler request targets the
first window by default. `editor windows --json` lists the open windows;
`--window-id <id>` scopes a command to another one (an unknown id fails with
"No QCut window with id …" instead of driving the wrong window).

While the Agent pointer overlay is visible, screen recordings started from
QCut (`--record`, `demo run`) store its position in the cursor telemetry track
(`c: "agent"`) instead of the idle physical mouse, so recorded demos follow the
pointer viewers actually saw.

The result carries `dnd: { mode, intercepted, backend, mimeTypes, fileCount,
dragOperationsMask }`; `mimeTypes` lists what the page put in the drag, for
example `application/x-media-item`. Verify the timeline afterwards with
`editor timeline export`, since a completed drop is not proof of the intended
edit.
