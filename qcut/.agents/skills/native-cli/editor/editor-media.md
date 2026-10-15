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

### Get media info

```bash
qcut editor:media:info --project-id <id> --media-id <id>
```

### Import local file

```bash
qcut editor:media:import --project-id <id> --source /path/to/video.mp4
```

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
  --new-name "final-cut.mp4"
```

### Delete media

```bash
qcut editor:media:delete --project-id <id> --media-id <id>
```

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

### Duplicate project

```bash
qcut editor:project:duplicate --project-id <id>
```

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
| `--project-id` | string | | Project ID (required) |
| `--full` | boolean | `false` | Include all arrays (media, subtitles, generated, exports, jobs) |

### Export project state to disk

```bash
qcut editor:project:export-state --project-id <id>
qcut editor:project:export-state --project-id <id> --output ./state.json
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--project-id` | string | | Project ID (required) |
| `--output` | string | `./output/project-<id>.json` | Output file path |

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
