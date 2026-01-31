# QCut Technical Documentation

Technical reference documentation for QCut's architecture, workflows, and implementation details.

## Directory Structure

```
docs/technical/
├── architecture/       # System architecture and code structure
├── ai/                 # AI video generation and models
│   └── models/         # Per-model documentation
├── testing/            # Testing guides and infrastructure
├── workflows/          # Sequence diagrams and process flows
└── guides/             # How-to guides and commands
```

## Quick Links

### Architecture
| Document | Description |
|----------|-------------|
| [source-code-structure.md](architecture/source-code-structure.md) | Complete codebase structure with file counts |
| [terminal-architecture.md](architecture/terminal-architecture.md) | xterm.js integration and terminal system |
| [virtual-folder-system.md](architecture/virtual-folder-system.md) | Media organization metadata system |

### AI Video Generation
| Document | Description |
|----------|-------------|
| [workflow.md](ai/workflow.md) | End-to-end AI video generation workflow |
| [skills-system.md](ai/skills-system.md) | How skills work in QCut |
| [models/](ai/models/) | Per-category model documentation |

### AI Models by Category
| Category | Path | Models |
|----------|------|--------|
| Text-to-Video | [ai/models/text-to-video/](ai/models/text-to-video/) | Sora 2, Veo 3, Kling, MiniMax |
| Image-to-Video | [ai/models/image-to-video/](ai/models/image-to-video/) | Runway, Kling, Luma |
| Avatar | [ai/models/avatar/](ai/models/avatar/) | Hedra, Sync, Hailuo |
| Transcription | [ai/models/transcription/](ai/models/transcription/) | ElevenLabs, Whisper |
| Text-to-Image | [ai/models/text-to-image/](ai/models/text-to-image/) | Flux, SDXL |
| Image Upscale | [ai/models/image-upscale/](ai/models/image-upscale/) | Real-ESRGAN |
| Segmentation | [ai/models/segmentation/](ai/models/segmentation/) | SAM, BiRefNet |
| Adjustment | [ai/models/adjustment-panel/](ai/models/adjustment-panel/) | Color grading |

### Testing
| Document | Description |
|----------|-------------|
| [infrastructure.md](testing/infrastructure.md) | Test setup, mocking, Vitest config |
| [e2e.md](testing/e2e.md) | End-to-end testing with Playwright |

### Workflows
| Document | Description |
|----------|-------------|
| [effects-sequence.md](workflows/effects-sequence.md) | Video effects pipeline flow |
| [drawing-canvas-sequence.md](workflows/drawing-canvas-sequence.md) | Canvas drawing implementation |

### Guides
| Document | Description |
|----------|-------------|
| [build-commands.md](guides/build-commands.md) | Build, run, and deploy commands |
