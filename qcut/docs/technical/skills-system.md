# Skills System Architecture

This document describes QCut's AI skills system for managing and running AI agent capabilities from the media panel.

## Overview

Skills are AI agent instructions stored as markdown files with YAML frontmatter. They provide context to Gemini CLI for specialized tasks like video generation, FFmpeg operations, etc.

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process                          │
│  ┌───────────────────┐  ┌─────────────────────────────────┐ │
│  │   Skills Tab      │  │     Skill Card                  │ │
│  │  [+ Import]       │  │  🧠 AI Content Pipeline         │ │
│  │                   │  │  Generate AI content...         │ │
│  │  ┌─────────────┐  │  │  [Run] [Delete]                 │ │
│  │  │ skill list  │──┼──│                                 │ │
│  │  └─────────────┘  │  └─────────────────────────────────┘ │
│  └───────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
          │                           │ Run clicked
          │ IPC                       ▼
          ▼                 ┌─────────────────────────────────┐
┌─────────────────────────  │   use-skill-runner.ts           │
│  skills-handler.ts     │  │   1. Set skill context          │
│  (Electron Main)       │  │   2. Enable Gemini mode         │
│  - List skills         │  │   3. Switch to PTY tab          │
│  - Import skill        │  │   4. Auto-connect               │
│  - Delete skill        │  │   5. Send skill prompt          │
│  - Get path            │  └─────────────────────────────────┘
└─────────────────────────┘
```

## Skill Storage

### Project Structure
```
Documents/QCut/Projects/{projectId}/
├── project.qcut
├── media/
└── skills/                          ← Skills folder
    ├── ai-content-pipeline/
    │   ├── Skill.md                 ← Main file (required)
    │   ├── REFERENCE.md             ← Additional docs
    │   └── CONCEPTS.md
    └── ffmpeg-skill/
        └── Skill.md
```

### Skill.md Format
```markdown
---
name: AI Content Pipeline
description: Generate AI content using 51 models
dependencies: python>=3.10
---

# Skill Instructions

When user asks to generate video...
```

## Data Model

### Skill Interface

```typescript
interface Skill {
  id: string;              // Same as folderName
  name: string;            // From frontmatter
  description: string;     // From frontmatter
  dependencies?: string;   // e.g., "python>=3.10"
  folderName: string;      // Directory name in skills/
  mainFile: string;        // "Skill.md"
  additionalFiles: string[]; // ["REFERENCE.md", ...]
  content: string;         // Full markdown content
  createdAt: number;
  updatedAt: number;
}
```

### Frontmatter Parsing

```typescript
function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  // Parse YAML key: value lines
  const yaml = match[1];
  // ... returns { name, description, dependencies }
}
```

## Key Components

### 1. Skills Handler (`electron/skills-handler.ts`)

Electron IPC handlers for skill file operations.

**IPC Channels:**
| Channel | Description |
|---------|-------------|
| `skills:list` | List all skills in project |
| `skills:import` | Copy skill from source to project |
| `skills:delete` | Remove skill folder from project |
| `skills:getContent` | Read specific .md file |
| `skills:getPath` | Get project's skills folder path |
| `skills:scanGlobal` | Find available skills (bundled + ~/.claude/skills) |
| `skills:browse` | Open folder picker dialog |

**Security:**
- Path traversal prevention via `isPathWithinBase()` and `sanitizePathSegment()`
- Only allows importing from bundled or global skills directories
- Only `.md` files can be read via `getContent`

### 2. Skills Store (`apps/web/src/stores/skills-store.ts`)

Zustand store for skill state in renderer.

```typescript
interface SkillsState {
  skills: Skill[];
  availableSkills: AvailableSkill[];  // From scanGlobal
  isLoading: boolean;
}

interface SkillsActions {
  loadSkills(projectId: string): Promise<void>;
  scanAvailable(): Promise<void>;
  importSkill(projectId: string, sourcePath: string): Promise<Skill | null>;
  deleteSkill(projectId: string, skillId: string): Promise<void>;
}
```

### 3. Skill Runner (`apps/web/src/hooks/use-skill-runner.ts`)

Hook that connects skills to Gemini CLI terminal.

**Run Flow:**
```typescript
async function runSkill(skillId: string) {
  // 1. Find skill by ID
  const skill = skills.find(s => s.id === skillId);

  // 2. Get project's skills folder path
  const skillsPath = await electronAPI.skills.getPath(projectId);

  // 3. Set skill as active context (for prompt injection)
  setActiveSkill({ id, name, content: skill.content });

  // 4. Enable Gemini CLI mode
  setGeminiMode(true);

  // 5. Set working directory
  setWorkingDirectory(skillsPath);

  // 6. Switch to PTY terminal tab
  setActiveTab("pty");

  // 7. Connect (or reconnect) to Gemini CLI
  await connect();

  // 8. After 2s delay, skill prompt is auto-sent by store
}
```

### 4. PTY Terminal Integration

The `pty-terminal-store.ts` handles skill context:

```typescript
interface PtyTerminalState {
  activeSkill: ActiveSkillContext | null;
  skillPromptSent: boolean;
}

// Skill prompt sent after Gemini CLI initializes
function sendSkillPrompt() {
  const prompt = `I'm using the "${skill.name}" skill. Here are the instructions:

${skill.content}

Please acknowledge and help with tasks using this skill.`;

  electronAPI.pty.write(sessionId, prompt + "\n");
}
```

## Data Flow

### Loading Skills
```
Project opens → skillsStore.loadSkills(projectId)
                        │
                        ▼ IPC
               skills:list handler
                        │
                        ▼
               Read skills/{folder}/Skill.md
                        │
                        ▼
               Parse frontmatter + list .md files
                        │
                        ▼
               Return Skill[] to renderer
```

### Importing a Skill
```
User clicks Import → ImportSkillDialog
                           │
                           ▼
                  skillsStore.scanAvailable()
                           │
                           ▼ IPC
                  skills:scanGlobal
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     Bundled skills           ~/.claude/skills
     (resources/default-skills)
              │                         │
              └────────────┬────────────┘
                           ▼
                  User selects skill
                           │
                           ▼
                  skills:import (copies folder)
                           │
                           ▼
                  Skill appears in list
```

### Running a Skill
```
User clicks [Run] → useSkillRunner.runSkill(id)
                           │
                           ▼
                  Set activeSkill in PTY store
                           │
                           ▼
                  Switch to PTY tab + connect
                           │
                           ▼
                  Gemini CLI spawns
                           │
                           ▼ (2s delay)
                  sendSkillPrompt() injects context
                           │
                           ▼
                  User interacts with skill-aware Gemini
```

## Security Considerations

### Path Validation

```typescript
// Validate resolved path is within allowed base
function isPathWithinBase(targetPath: string, basePath: string): boolean {
  const resolved = path.resolve(targetPath);
  const base = path.resolve(basePath);
  return resolved.startsWith(base + path.sep) || resolved === base;
}

// Windows reserved device names
const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// Sanitize folder/file names (includes Windows reserved name check)
function sanitizePathSegment(segment: string): string {
  let sanitized = segment.replace(/[/\\]/g, "").replace(/\.\./g, "");
  // Reject Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  if (WINDOWS_RESERVED_NAMES.has(sanitized.split(".")[0].toUpperCase())) {
    return ""; // Triggers validation failure
  }
  return sanitized;
}
```

### Import Restrictions
- Only imports from:
  - Bundled skills: `{resourcesPath}/default-skills`
  - Global skills: `~/.claude/skills`
- Validates source contains `Skill.md`
- Uses sanitized folder names for destination

### Read Restrictions
- `skills:getContent` only allows `.md` files
- Path traversal blocked via sanitization + base path check

## Skill Sources

| Source | Path | Description |
|--------|------|-------------|
| Bundled | `resources/default-skills/` | Shipped with app |
| Global | `~/.claude/skills/` | User's Claude skills |
| Project | `{project}/skills/` | Imported into project |

## Related Files

| File | Purpose |
|------|---------|
| `electron/skills-handler.ts` | IPC handlers for file operations |
| `stores/skills-store.ts` | Skill state management |
| `hooks/use-skill-runner.ts` | Run skill with Gemini CLI |
| `types/skill.ts` | Skill interfaces + frontmatter parser |
| `components/editor/media-panel/views/skills.tsx` | Skills tab UI |
| `components/editor/media-panel/skill-card.tsx` | Individual skill card |
| `components/editor/media-panel/import-skill-dialog.tsx` | Import modal |
| `stores/pty-terminal-store.ts` | Skill context for terminal |
