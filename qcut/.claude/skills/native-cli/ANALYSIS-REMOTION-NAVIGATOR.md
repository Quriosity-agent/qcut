# Video Analysis, Remotion Generation & Editor Navigation CLI

Commands for AI video analysis, Remotion component generation, and programmatic editor navigation.

## Prerequisites

```bash
# Start QCut editor (required for editor:* and generate-remotion --add-to-timeline)
bun run electron:dev

# Run commands
bun run pipeline <command> [options]
# Or directly:
bun electron/native-pipeline/cli/cli.ts <command> [options]
```

---

## Video Analysis Commands

AI-powered video analysis via the running QCut editor.

### Analyze video

```bash
# Analyze by media ID
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "media:<media-id>" \
  --analysis-type describe \
  --model gemini

# Analyze by file path
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "path:/path/to/video.mp4"

# Analyze a timeline element
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "timeline:<element-id>"

# Custom prompt with JSON output
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "media:<id>" \
  --prompt "Count the number of people in each scene" \
  --output-format json
```

Source format: `media:<id>`, `path:/file/path`, `timeline:<elementId>`, or bare `/file/path`

### List analysis models

```bash
bun run pipeline editor:analyze:models
```

### Detect scenes

```bash
bun run pipeline editor:analyze:scenes \
  --project-id <id> \
  --media-id <id> \
  --threshold 0.5 \
  --model gemini
```

`--threshold` is a float 0-1. Lower values detect more scene changes.

### Analyze frames

```bash
# At specific timestamps (comma-separated seconds)
bun run pipeline editor:analyze:frames \
  --project-id <id> \
  --media-id <id> \
  --timestamps "0,5,10,15,20"

# At regular intervals
bun run pipeline editor:analyze:frames \
  --project-id <id> \
  --media-id <id> \
  --gap 5 \
  --prompt "Describe the mood of this frame"
```

### Detect filler words

```bash
# Auto-transcribe and detect fillers
bun run pipeline editor:analyze:fillers \
  --project-id <id> \
  --media-id <id>

# With pre-existing word data
bun run pipeline editor:analyze:fillers \
  --project-id <id> \
  --data @words.json
```

### Analysis options

| Flag | Type | Description |
|------|------|-------------|
| `--project-id` | string | Project identifier (required) |
| `--source` | string | Source specifier: `media:<id>`, `path:/file`, `timeline:<id>` |
| `--media-id` | string | Media file identifier |
| `--analysis-type` | string | Analysis type: `describe`, `summary`, custom |
| `--model` | string | AI model key (e.g., `gemini`) |
| `--output-format` | string | Output format: `json`, `md` |
| `--prompt` | string | Custom analysis prompt |
| `--threshold` | number | Scene detection threshold (0-1) |
| `--timestamps` | string | Comma-separated frame timestamps |
| `--gap` | number | Interval in seconds between frames |
| `--data` | string | JSON input (inline, `@file.json`, or `-` for stdin) |

---

## Transcription Commands

Speech-to-text transcription via the running QCut editor.

### Transcribe (synchronous)

```bash
bun run pipeline editor:transcribe:run \
  --project-id <id> \
  --media-id <id> \
  --language en \
  --provider deepgram

# Transcribe and load into Smart Speech panel
bun run pipeline editor:transcribe:run \
  --project-id <id> \
  --media-id <id> \
  --load-speech
```

### Transcribe (async with polling)

```bash
# Start and poll until complete
bun run pipeline editor:transcribe:start \
  --project-id <id> \
  --media-id <id> \
  --poll \
  --poll-interval 2 \
  --timeout 120

# Transcribe, poll, and load into Smart Speech panel
bun run pipeline editor:transcribe:start \
  --project-id <id> \
  --media-id <id> \
  --poll \
  --load-speech
```

### Job management

```bash
bun run pipeline editor:transcribe:status --project-id <id> --job-id <id>
bun run pipeline editor:transcribe:list-jobs --project-id <id>
bun run pipeline editor:transcribe:cancel --project-id <id> --job-id <id>
```

### Transcription options

| Flag | Type | Description |
|------|------|-------------|
| `--language` | string | Language code (e.g., `en`, `zh`) |
| `--provider` | string | Provider (e.g., `deepgram`) |
| `--no-diarize` | boolean | Disable speaker diarization |
| `--load-speech` | boolean | Load result into Smart Speech panel |
| `--poll` | boolean | Auto-poll until complete |
| `--poll-interval` | number | Poll interval in seconds (default: 3) |
| `--timeout` | number | Job timeout in seconds (default: 300) |

---

## Remotion Generation Command

Generate Remotion animation projects from text prompts using Claude Code with Remotion best-practice skills.

### Basic generation

```bash
# Generate a Remotion project folder
bun run pipeline generate-remotion \
  --prompt "a bouncing ball with trail effect"

# Custom duration and component name
bun run pipeline generate-remotion \
  --prompt "a cinematic title card with particle effects" \
  --duration 8 \
  --filename "TitleCard"
```

### Generate and add to timeline

Requires QCut editor to be running.

```bash
# Generate and import to timeline in one step
bun run pipeline generate-remotion \
  --prompt "A sleek QCut promotional demo with animated UI elements" \
  --duration 8 \
  --add-to-timeline \
  --project-id <id>
```

### How it works

1. Locates the Remotion skill at `.agents/skills/remotion-best-practices/SKILL.md`
2. Invokes `claude -p` with all tools — Claude reads the skill, learns best practices, then writes files
3. Generates a folder at `output/<ComponentName>/src/`:
   - `Root.tsx` — `<Composition>` declarations
   - `<ComponentName>.tsx` — main animation component
   - `package.json` — minimal dependencies for validation
4. When `--add-to-timeline` is set: imports folder via `remotion-folder:import` pipeline (scan, bundle with esbuild, load, register)

### Output structure

```
output/<ComponentName>/
  ├── <ComponentName>.json     # Generation metadata
  └── src/
      ├── Root.tsx              # Composition declarations
      ├── <ComponentName>.tsx   # Animation component(s)
      └── package.json          # Dependencies
```

### Remotion options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--prompt` / `-t` | string | (required) | Animation description |
| `--filename` | string | from prompt | Component name (PascalCase) |
| `--duration` / `-d` | number | `5` | Duration in seconds |
| `--output-dir` / `-o` | string | `./output` | Output directory |
| `--add-to-timeline` | boolean | `false` | Import to editor timeline |
| `--project-id` | string | - | Project ID (required with `--add-to-timeline`) |

### Remotion constraints enforced

- All animations driven by `useCurrentFrame()` + `interpolate()` with `extrapolateRight: "clamp"`
- CSS animations and Tailwind animation classes are forbidden
- Inline styles only — no external CSS
- No dependencies beyond `remotion` and `react`
- Fixed canvas: 1920x1080 at 30fps

---

## Editor Navigator Commands

List projects and navigate the running QCut editor to a specific project. Essential for automated end-to-end testing.

### List all projects

```bash
bun run pipeline editor:navigator:projects
```

Returns:
```json
{
  "projects": [
    {
      "id": "fea526ea-ff71-4329-aca9-d22b9a173982",
      "name": "My Project",
      "createdAt": "2026-02-13T00:05:24.783Z",
      "updatedAt": "2026-02-23T10:45:43.383Z"
    }
  ],
  "activeProjectId": "fea526ea-ff71-4329-aca9-d22b9a173982"
}
```

### Open project in editor

```bash
bun run pipeline editor:navigator:open \
  --project-id fea526ea-ff71-4329-aca9-d22b9a173982
```

Returns:
```json
{
  "navigated": true,
  "projectId": "fea526ea-ff71-4329-aca9-d22b9a173982"
}
```

The editor navigates to the project view, loads the timeline, media, and skills.

---

## Common Workflows

### End-to-end: Generate Remotion and preview

```bash
# 1. Start QCut
bun run electron:dev

# 2. List projects to get an ID
bun run pipeline editor:navigator:projects

# 3. Open the project
bun run pipeline editor:navigator:open --project-id <id>

# 4. Generate Remotion and add to timeline
bun run pipeline generate-remotion \
  --prompt "a bouncing ball with trail effect" \
  --duration 5 \
  --add-to-timeline \
  --project-id <id>

# 5. Export timeline to verify
bun run pipeline editor:timeline:export --project-id <id>
```

### Analyze video, then auto-edit

```bash
PROJECT=<project-id>
MEDIA=<media-id>
ELEMENT=<element-id>

# 1. Detect scenes
bun run pipeline editor:analyze:scenes \
  --project-id $PROJECT --media-id $MEDIA --threshold 0.3

# 2. Analyze specific frames
bun run pipeline editor:analyze:frames \
  --project-id $PROJECT --media-id $MEDIA --gap 10

# 3. Transcribe
bun run pipeline editor:transcribe:start \
  --project-id $PROJECT --media-id $MEDIA --poll --load-speech

# 4. Auto-remove fillers and silences
bun run pipeline editor:editing:auto-edit \
  --project-id $PROJECT --element-id $ELEMENT --media-id $MEDIA \
  --remove-fillers --remove-silences --poll
```

---

## Key Source Files

| Component | File |
|-----------|------|
| CLI entry point | `electron/native-pipeline/cli.ts` |
| Editor command dispatch | `electron/native-pipeline/cli/cli-handlers-editor.ts` |
| Analysis handlers | `electron/native-pipeline/editor/editor-handlers-analysis.ts` |
| Remotion handler | `electron/native-pipeline/cli/cli-handlers-remotion.ts` |
| Navigator IPC handler | `electron/claude/handlers/claude-navigator-handler.ts` |
| Navigator bridge (renderer) | `apps/web/src/lib/claude-bridge/claude-navigator-bridge.ts` |
| Remotion skills | `.agents/skills/remotion-best-practices/SKILL.md` |
| HTTP API server | `electron/claude/http/claude-http-server.ts` |
