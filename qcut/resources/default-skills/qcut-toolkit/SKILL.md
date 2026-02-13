---
name: qcut-toolkit
description: Unified QCut media toolkit — organize project files, process media with FFmpeg, generate AI content, and control the QCut editor via API. Use when the user asks about any media workflow, file organization, video processing, AI generation, editor control, or content pipeline task.
argument-hint: [task description]
---

# QCut Toolkit

Unified entry point for QCut's four core capabilities. Route tasks to the appropriate sub-skill based on what the user needs.

## Sub-Skills

### 1. organize-project — File & Folder Organization
**When:** Setting up a project, cleaning up files, organizing workspace, importing media
**Invoke:** `/organize-project`
**Skill path:** `.claude/skills/organize-project/SKILL.md`

Handles:
- Creating QCut's standard folder structure (`media/imported/`, `media/generated/`, `output/`, etc.)
- Hybrid symlink/copy import system for media files
- Virtual folder system for metadata-only organization
- Cleaning up temp files and empty directories

### 2. ffmpeg-skill — Media Processing
**When:** Converting, compressing, trimming, resizing, extracting audio, adding subtitles, creating GIFs, applying effects
**Invoke:** `/ffmpeg-skill`
**Skill path:** `.claude/skills/ffmpeg-skill/Skill.md`

Handles:
- Format conversion (MP4, MKV, WebM, MP3, etc.)
- Video compression (`-crf`), resizing (`scale=`), trimming (`-ss`/`-t`)
- Audio extraction, subtitle burn-in, text overlays
- GIF creation, speed changes, merging/concatenation
- Streaming (HLS, DASH, RTMP) and complex filtergraphs

### 3. ai-content-pipeline — AI Content Generation & Analysis
**When:** Generating images/videos/avatars, transcribing audio, analyzing video, running AI pipelines
**Invoke:** `/ai-content-pipeline`
**Skill path:** `.claude/skills/ai-content-pipeline/Skill.md`

Handles:
- Text-to-image (FLUX, Imagen 4, Nano Banana Pro, GPT Image)
- Image-to-video (Veo 3, Sora 2, Kling, Hailuo)
- Avatar/lipsync generation (OmniHuman, Fabric, Multitalk)
- Speech-to-text transcription with word-level timestamps (Scribe v2)
- Video analysis with Gemini 3 Pro
- YAML pipeline orchestration with parallel execution
- Motion transfer between images and videos

### 4. qcut-api — Editor Control API
**When:** Controlling QCut programmatically, managing media/timeline/project via REST or IPC, getting export presets, diagnosing errors
**Invoke:** `/qcut-api`
**Skill path:** `.claude/skills/qcut-api/SKILL.md`

Handles:
- HTTP REST API at `http://127.0.0.1:8765/api/claude/*` (18 endpoints)
- Media management (list, import, delete, rename files)
- Timeline read/write (export JSON/Markdown, add/update/remove elements)
- Project settings (get/update name, resolution, FPS, format)
- Export presets and platform recommendations (YouTube, TikTok, Instagram, etc.)
- Error diagnostics with system info

## Routing Logic

When the user's request involves multiple sub-skills, chain them in this order:

1. **Organize first** — Ensure project structure exists before processing
2. **Process with FFmpeg** — Convert, trim, or prepare source media
3. **Generate with AI** — Create new content or analyze existing media
4. **Control editor** — Use the API to update timeline, settings, or import results
5. **Organize output** — Place results in `media/generated/` or `output/`

### Quick Routing Table

| User says | Route to |
|-----------|----------|
| "organize", "set up project", "clean up files" | organize-project |
| "convert", "compress", "trim", "resize", "extract audio", "gif", "subtitle" | ffmpeg-skill |
| "generate image", "generate video", "avatar", "lipsync", "transcribe", "analyze video", "AI pipeline" | ai-content-pipeline |
| "add to timeline", "update project settings", "list media", "export preset", "configure for TikTok" | qcut-api |
| "import media via API", "get project stats", "diagnose error" | qcut-api |
| "process this video and generate thumbnails" | ffmpeg-skill then ai-content-pipeline |
| "import media and organize" | organize-project |
| "generate content and add to timeline" | ai-content-pipeline then qcut-api |
| "set up project then generate content" | organize-project then ai-content-pipeline |

### Multi-Step Workflow Example

User: "Take my raw footage, trim the first 30 seconds, compress it, then generate AI thumbnails"

1. `/organize-project` — Ensure `media/imported/` has the source file
2. `/ffmpeg-skill` — `ffmpeg -ss 00:00:30 -i input.mp4 -c copy trimmed.mp4` then compress
3. `/ai-content-pipeline` — Extract a frame, generate styled thumbnail with `flux_dev`
4. Place output in `media/generated/images/` and `output/`

## Output Structure

All sub-skills follow the same project structure:

```
Documents/QCut/Projects/{project-name}/
├── media/imported/     ← organize-project (symlinks/copies)
├── media/generated/    ← ai-content-pipeline output
│   ├── images/
│   ├── videos/
│   └── audio/
├── media/temp/         ← ffmpeg-skill intermediates
├── output/             ← final exports (ffmpeg-skill)
└── cache/              ← processing cache
```

## When All Three Are Needed

For full production workflows:

```
$ARGUMENTS
```

Break the request into steps, invoke each sub-skill in sequence, and report progress after each step. Always confirm destructive operations (overwriting files, deleting temp data) before executing.
