# QCut Editor CLI — Media & Project Commands

See [editor-core.md](editor-core.md) for connection options, flags, and workflows.

---

## Media Commands

### List media

```bash
qcut editor:media:list --project-id <id>
```

Each item carries what you need to place it, read from the file with ffprobe
(and cached while the file is unchanged):

| Field | Meaning |
|-------|---------|
| `duration` | Seconds; for video, the length of the video stream |
| `dimensions` | `{ "width", "height" }` for video and images |
| `fps` | Frame rate, for video |

A file ffprobe cannot read keeps these fields empty instead of failing the
listing. `editor:media:info` returns the same fields for one item.

The payload is the list itself, an array of items, not an object holding
one (`--json --flat` prints `[{ "id": … }, …]`; without `--flat` the array
is `.data.data`). `media batch-import` answers with an array of results in
the same way, one per item in the order given, unless `--append-to-track`
is used (then an object, see below). Most other commands answer with an
object.

### Get media info

```bash
qcut editor:media:info --project-id <id> --media-id <id>
```

An id that is not in the project is an error (`Media not found: <id>`, HTTP
404), not an empty answer.

### Import local file

```bash
qcut editor:media:import --project-id <id> --source /path/to/video.mp4
```

An import copies the file into the project
(`Documents/QCut/Projects/<project-id>/media/`). The project plays its copy
from then on, so changing the original afterwards changes nothing in the
project.

Importing a file whose name the project already has does not write over the
first one: the new copy is stored as `name_1.ext` (then `_2`, …) and becomes
a second media item with an id of its own, and the clips on the timeline go
on playing the first. To put a new render in an item's place, use
[`media replace`](#replace-a-media-item-with-a-new-file).

### Import from URL

```bash
qcut editor:media:import-url \
  --project-id <id> \
  --url "https://example.com/video.mp4" \
  --filename "my-video.mp4"
```

### Batch import (max 20 items)

```bash
qcut editor:media:batch-import \
  --project-id <id> \
  --items '[{"path":"/path/to/a.mp4"},{"url":"https://example.com/b.mp4"}]'

# "source" is also accepted as an alias for "path"
# From file: --items @imports.json

# Import and lay the video/audio end to end at the end of a track
qcut editor:media:batch-import \
  --project-id <id> \
  --sources "/clips/01.mp4,/clips/02.mp4,/clips/03.mp4" \
  --append-to-track <track-id>
```

A batch import answers once the open editor has loaded each copied file, so
an `add-element` right after finds it. Each result says `"editorReady":true`;
a file the editor has not confirmed within 20 s in all is `"editorReady":false`
with a `warning` (it keeps loading, and `add-element` waits for it). Each
successful result's `mediaFile` also carries the fields `media list` reports
(`duration`, `dimensions`, `fps`), so trims can be worked out without listing
the media again.

With `--append-to-track`, each imported video or audio file is added after the
previous one at its own length, in import order. The result has `imported`,
`appended` (the batch-add result) and `skipped` (still images, which have no
length of their own; add them with a `duration`).

### Extract a frame

```bash
qcut editor:media:extract-frame \
  --project-id <id> \
  --media-id <id> \
  --start-time 5.0 \
  --output-format png
```

### Rename media

```bash
qcut editor:media:rename \
  --project-id <id> \
  --media-id <id> \
  --new-name "final-cut.mp4" --json
```

A media id is made from the file's name (`media_` + the name in base64), so
**a renamed file has a new id**. The rename takes the project along:

- the editor's item gets the new id, name and path;
- every clip that played the old id plays the new one, in the open scene and
  in the others (locked tracks too), and so do the stickers, on the timeline
  and over the preview; the undo and redo steps follow, so undoing an
  earlier edit does not bring the old id back;
- the answer gives both: `{ "renamed": true, "id": "<new>", "name":
  "final-cut.mp4", "previousId": "<old>", "previousName": "…" }`. A script
  that kept the old id needs `id` from here on.

The extension is kept when the new name has none. A name another file
already has gets a suffix (`final-cut_1.mp4`), also when that file appears
while the rename is under way: a file is never moved onto another. The
answer's `name` says what it became. Renaming a file to its own name changes
nothing (`renamed: false`). An id that is not in the project is an error
(404). If the editor cannot follow the rename (a scene that cannot be saved,
a file so large that copying it outlasts the 30 s the request waits, the
project closed or another project or scene opened meanwhile), it takes back
what it had changed, the file is put back under its old name and the command
fails. Taking back is attempted, not promised: it leaves the project as it
was unless the answer says otherwise, in one of three ways.

- The editor could not take back everything it had changed ("Not everything
  could be taken back"; the error names what), or its answer did not come.
  The editor is then asked once more to end on the old id before the file
  goes back. The error says "did not confirm" when it has not.
- The file could not be put back (its old name was taken meanwhile). The
  editor is then asked to follow the file under its new name. When it does,
  **the rename stands and the command succeeds**, with a `warning` that says
  what happened: use `id` from the answer as after any rename. When it does
  not, the command fails and the error says that the file "stays renamed".
- The editor could not be asked at all (it was reloaded, its window is gone).

The desktop app notes every rename before it moves the file, and keeps the
note until the editor is known to be where the file is; a rename it cannot
note is not made ("could not be noted … nothing was changed"). What is still
apart after a failure, or after the app was closed in the middle of a
rename, the editor settles from the name the file has when the project is
next opened; the renamed file is told from another file that has taken its
old name by its size and the time it was changed. After a rename that failed,
look at the file's name and at what the error names (`media list`,
`timeline export`) before the rename is tried again. One request can wait
for the editor three times, so the command waits up to two minutes.
Renames of one project are done one after the other, also when they are
asked for at the same time.

### Replace a media item with a new file

For a file rendered again (a shake pass, a sound effect on its third take):
the new file is imported, every clip that played the old item plays the new
one, and the old item is removed.

```bash
qcut editor:media:replace \
  --project-id <id> --media-id <old-media-id> --source ./shake_03.mov --force --json
```

- Every clip keeps its place, length, trims and settings, as with
  `timeline replace-media`; all of them change in one undo step.
- A clip that cannot take the new file refuses the whole replace (the file
  ends before the clip's out-point, for one; the reasons are those of
  [`timeline replace-media`](editor-timeline.md#replace-a-clips-media)): no
  clip is changed and the import is taken back out, so the project is as it
  was.
- The new file is imported as an item of its own, so nothing the editor
  worked out for the old file (thumbnail, waveform, alpha proxy) is shown
  for the new one. The answer gives `mediaId` and `name`, with `oldMediaId`,
  `oldName` and the `clips` that changed.
- **A file with the old item's name keeps that name.** It is imported beside
  the old item as `name_1.ext`, because the name is still taken; once the old
  item is gone it is given the name back (`importedAs` says what it was
  called meanwhile). Its id follows its name, so `mediaId` is then the id
  the old item had, and a script that finds media by file name or by that id
  still finds it. A file with another name keeps its own name and id. If
  the name cannot be given back, the item keeps `name_1.ext` and a `warning`
  says so.
- The old item is removed only once no clip plays it (`oldMediaRemoved`).
  If one still does, it is kept and a `warning` names the clips.

It sits in the confirm tier (`--force`): it removes a media item.

### A file changed in the project folder

The editor copies every media file into its own store when it imports it;
the preview and the renderer export play that copy. The native export and
`media list` read the file in the project folder. So a file written over in
`Documents/QCut/Projects/<project-id>/media/` under the same name left the
two apart: the preview showed the old picture, the export held the new one.

The editor now reads such a file again. It compares each file's size and
modification time with what it copied, and reads the ones that changed:

- when its window is looked at again after another app had it, and once
  after a project's media has loaded;
- before `timeline apply`, a batch add and every `export start`;
- when asked:

```bash
qcut editor media refresh --project-id <id> --json
# { "checked": 197, "refreshed": [{ "id": "media_…", "name": "shake.mp4" }], "failed": [] }
```

`refreshed` lists the files it read again (thumbnail, length and size are
made again from the new file); `failed` lists those it could not bring up to
date (a file it could not read, an item that was removed or replaced while
its file was being read, an item of a rename that is not settled yet: it is
read once the rename is), and the command then fails. So does a check that
could not look at every file because the project was closed or another one
opened meanwhile. An `export start` that goes through the renderer engine is
refused while a file that a clip on the timeline plays is in `failed`, or
while the check has not answered within 15 s (it may still be reading a
large file: retry), since it would draw the old copy; a native export reads
the folder and goes ahead.

Writing over a file is still the wrong tool when a clip has to keep working:
a file that got shorter leaves its clips running past its end. `media
replace` checks every clip against the new file first.

### Delete media

```bash
qcut editor:media:delete --project-id <id> --media-id <id>
```

The clips on the timeline that play the item are removed with it.

---

## Project Commands

### Get settings

```bash
qcut editor:project:settings --project-id <id>
```

These are read from the project's `project.qcut`. Changes made in the editor
(the canvas picker, the first clip fitting the canvas) are written back to it,
so this agrees with `editor:timeline:export`.

### Update settings

```bash
qcut editor:project:update-settings \
  --project-id <id> \
  --data '{"fps":30,"width":1920,"height":1080}'
```

Pick a canvas ratio by its menu name instead of spelling out dimensions
(`--ratio` accepts 16:9, 4:3, 2.35:1, 2:1, 1.85:1, 9:16, 3:4, 9:19.5 / 5.8寸,
1:1, 1:2 and lands on the same size the preview ratio menu uses; it merges
over `--data` when both are given). Passing only `"aspectRatio"` inside
`--data` derives the size from the *current* canvas instead (1920×1080 +
`"9:16"` → 608×1080), so prefer `--ratio` for named presets:

```bash
qcut editor:project:update-settings --project-id <id> --ratio 9:16
```

### Get statistics

```bash
qcut editor:project:stats --project-id <id>
```

### Get summary (markdown)

```bash
qcut editor:project:summary --project-id <id>
```

### Generate pipeline report

```bash
qcut editor:project:report \
  --project-id <id> \
  --output-dir ./reports \
  --clear-log
```

### Create project

```bash
qcut editor:project:create --new-name "My New Project"

# Canvas and frame rate matching your footage
qcut editor:project:create --name "Door Plan" --match-media /clips/01.mp4

# Or set them directly (explicit flags win over --match-media)
qcut editor:project:create --name "Door Plan" --width 1280 --height 720 --fps 24
```

Without these flags a new project starts on the default preset canvas, and
the first video or image added to its empty timeline fits the canvas to its
aspect ratio. Once a size is set (here, in the canvas picker, or with
`update-settings`), adding clips no longer changes it. The frame rate is never
taken from a clip automatically; use `--match-media` or `--fps`.

### Delete project

```bash
qcut editor:project:delete --project-id <id>
```

### Rename project

```bash
qcut editor:project:rename --project-id <id> --new-name "New Name"
```

Only the name changes: an open project keeps everything else as the editor
holds it, a closed one as it is stored.

### Duplicate project

```bash
qcut editor:project:duplicate --project-id <id>
```

The copy is named "原名（副本）" (then "（副本 2）"…) and carries everything the
project stores: media (same ids, files copied into the new project folder),
media folders, every scene's timeline with its transitions and track mixer
settings, overlay stickers, settings and buses. The open project is copied
as the editor holds it, so unsaved edits are in the copy; the Jianying draft
binding is not copied. Large projects can take a while (the command waits up to ~3 minutes).

### List all projects

```bash
qcut editor:project:list --json
```

Returns all projects with `id`, `name`, `createdAt`, `updatedAt`.

### Get project info (project.json)

```bash
# Minimal (~200 tokens): counts + settings only
qcut editor:project:info --project-id <id> --json

# Full (~2000 tokens): includes media[], subtitles[], generated[], exports[], jobs[]
qcut editor:project:info --project-id <id> --full --json
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--project-id` | string | the open project | Project ID; without it, the project the editor has open |
| `--full` | boolean | `false` | Include all arrays (media, subtitles, generated, exports, jobs) |

The result's `isActive` says whether the project is the one the editor has
open, so `qcut editor project info --json` answers "which project is open".
With no project open and no `--project-id` the command fails and says so.

A project's `updatedAt` (here and in `project list`) moves whenever its
timeline or media changes, from the editor or the CLI.

### Export project state to disk

```bash
qcut editor:project:export-state --project-id <id>
qcut editor:project:export-state --project-id <id> --output ./state.json
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--project-id` | string | | Project ID (required) |
| `--output` | string | `./output/project-<id>.json` | Output file path |

The file also holds `timeline` (the open editor's tracks with transitions,
track audio and buses, as `timeline export` returns it) when the project is
open; otherwise `timelineUnavailable` says why.

### Import project state (planned)

```bash
qcut editor:project:import-state --project-id <id> --data @state.json
```

| Flag | Type | Description |
|------|------|-------------|
| `--project-id` | string | Project ID (required) |
| `--data` | string | JSON input (`@file.json`, inline, or `-` for stdin) (required) |

**Note**: This command is defined but not yet implemented.

---

## project.json Schema

The `editor:project:info` command returns structured project state in two modes:

### Minimal mode (default, ~200 tokens)

```json
{
  "version": "1.0",
  "projectId": "abc-123",
  "name": "My Project",
  "createdAt": "2026-03-01T00:00:00.000Z",
  "updatedAt": "2026-03-04T12:00:00.000Z",
  "settings": {
    "width": 1920, "height": 1080, "fps": 30,
    "aspectRatio": "16:9", "outputFormat": "mp4"
  },
  "counts": {
    "media": { "video": 3, "audio": 1, "image": 2 },
    "subtitles": 0, "generated": 0, "tracks": 2, "elements": 5
  },
  "totalDuration": 120.5,
  "lastExport": null,
  "apiKeys": {
    "fal": true, "elevenlabs": false, "openrouter": true,
    "gemini": true, "anthropic": true, "openai": false, "freesound": false
  }
}
```

### Full mode (`--full`, ~2000 tokens)

Adds these arrays to the minimal schema:

| Array | Entry fields |
|-------|-------------|
| `media[]` | `id`, `type`, `name`, `path`, `duration`, `width`, `height`, `fps`, `importedAt` |
| `subtitles[]` | `id`, `mediaId`, `path`, `language`, `wordCount`, `generatedAt` |
| `generated[]` | `id`, `type`, `model`, `prompt`, `path`, `cost`, `generatedAt` |
| `exports[]` | `id`, `path`, `preset`, `format`, `width`, `height`, `size`, `duration`, `exportedAt` |
| `jobs[]` | `jobId`, `command`, `status`, `startedAt`, `completedAt`, `error` |

Also includes full `settings` with `backgroundColor`, `backgroundType`, `outputQuality`, `trackCount`, `elementCount`, `totalDuration`.

### API key status

The `apiKeys` object shows which keys are configured (boolean). Never exposes actual key values. Checked keys: `fal`, `elevenlabs`, `openrouter`, `gemini`, `anthropic`, `openai`, `freesound`.

### Source files

| Component | File |
|-----------|------|
| Schema types | `electron/native-pipeline/cli/project-json-types.ts` |
| Builder | `electron/native-pipeline/cli/project-json-builder.ts` |
