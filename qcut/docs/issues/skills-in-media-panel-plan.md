# Skills in Media Panel - Implementation Plan

**Feature:** Display and manage AI skills from the media panel
**Status:** Planning
**Priority:** Medium

---

## Overview

Allow users to view, manage, and use AI skills (Claude agent capabilities) directly from the QCut media panel. Skills would be stored per-project, making projects self-contained and shareable.

---

## Current State

### Skills Structure (`.claude/skills/`)
```
.claude/skills/
├── ai-content-pipeline/
│   ├── Skill.md          # Main skill definition
│   └── REFERENCE.md      # Additional docs
└── ffmpeg-skill/
    ├── Skill.md
    ├── REFERENCE.md
    ├── CONCEPTS.md
    └── ADVANCED.md
```

### Skill.md Format
```markdown
---
name: AI Content Pipeline
description: Generate AI content using 51 models
dependencies: python>=3.10
---

# Skill content and instructions...
```

---

## Proposed Architecture

### Option A: Skills as Special Folder in Virtual Folders
```
Media Panel
├── 📁 All Media
├── 📁 Videos
├── 📁 Audio
├── 🧠 Skills              ← New special folder
│   ├── AI Content Pipeline
│   └── FFmpeg Skill
```

**Pros:** Integrated with existing folder UI
**Cons:** Mixes different content types

### Option B: Dedicated Skills Tab (Recommended)
```
Media Panel Tabs:
[Media] [Audio] [Text] [AI] [Skills] ...
                             ↑ New tab
```

**Pros:** Clean separation, purpose-built UI
**Cons:** Another tab to maintain

### Option C: Skills as Media Items
Skills appear as draggable items in media panel, can be "dropped" to execute.

**Pros:** Familiar interaction pattern
**Cons:** Conceptually confusing (skills aren't media)

---

## Recommended: Option B (Skills Tab)

### Project Structure
```
Documents/QCut/Projects/MyProject/
├── project.qcut
├── media/
│   ├── imported/
│   └── generated/
├── skills/                    ← NEW: Project-specific skills
│   ├── ai-content-pipeline/
│   │   └── Skill.md
│   └── custom-skill/
│       └── Skill.md
└── cache/
```

### Skills Tab UI
```
┌─────────────────────────────────────────────────┐
│ Skills                              [+ Import]  │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ 🧠 AI Content Pipeline                      │ │
│ │ Generate AI content using 51 models         │ │
│ │ [Run] [Edit] [Delete]                       │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🎬 FFmpeg Skill                             │ │
│ │ Video processing and conversion             │ │
│ │ [Run] [Edit] [Delete]                       │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│   + Import skill from .claude/skills          │
│   + Create new skill                          │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└─────────────────────────────────────────────────┘
```

---

## Data Model

### Skill Interface
```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  dependencies?: string;        // e.g., "python>=3.10"
  folderPath: string;           // relative path in project
  mainFile: string;             // typically "Skill.md"
  additionalFiles: string[];    // REFERENCE.md, etc.
  createdAt: number;
  updatedAt: number;

  // Runtime state
  isInstalled?: boolean;        // dependencies installed?
  lastRunAt?: number;
}
```

### Skills Store
```typescript
interface SkillsState {
  skills: Skill[];
  selectedSkillId: string | null;
  isLoading: boolean;
}

interface SkillsActions {
  loadSkills: (projectId: string) => Promise<void>;
  importSkill: (sourcePath: string) => Promise<string>;
  createSkill: (name: string) => Promise<string>;
  deleteSkill: (id: string) => Promise<void>;
  runSkill: (id: string, params?: Record<string, any>) => Promise<void>;
}
```

---

## Implementation Tasks

### Task 1: Define Skill Types
- Create `skill-types.ts` with interfaces
- Add Skill to storage types

### Task 2: Create Skills Store
- Zustand store for skill state
- CRUD operations
- Persistence via StorageService

### Task 3: Add Skills Storage to StorageService
- `saveSkills()` / `loadSkills()` methods
- File system operations for skill folders
- Parse Skill.md frontmatter

### Task 4: Create Skills Tab UI
- Add "skills" to Tab type in media-panel/store.ts
- Create `views/skills.tsx` component
- Skill card component with actions

### Task 5: Skill Import Dialog
- Browse to .claude/skills or any folder
- Copy skill folder to project
- Parse and validate Skill.md

### Task 6: Skill Runner Integration
- Connect to Gemini terminal for execution
- Pass skill context to AI
- Handle dependencies check

---

## Key Questions to Decide

### Q1: Where to store skills?

| Option | Path | Pros | Cons |
|--------|------|------|------|
| A | `project/skills/` | Self-contained, shareable | Duplicates across projects |
| B | Global `.claude/skills/` + reference | No duplication | Projects not portable |
| C | Hybrid: copy on first use | Balance | Complexity |

**Recommendation:** Option A (project folder) for portability

### Q2: How to run skills?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A | Send to Gemini terminal | Built-in, contextual | Requires Gemini tab |
| B | Dedicated skill runner | Purpose-built | More UI to build |
| C | Drop on timeline/media | Visual workflow | Conceptual mismatch |

**Recommendation:** Option A (Gemini terminal integration)

### Q3: Skill editing?

| Option | Description |
|--------|-------------|
| A | Open in VS Code | External editor |
| B | In-app markdown editor | Integrated but complex |
| C | Read-only view + external edit | Simple |

**Recommendation:** Option C initially, Option B later

### Q4: Skill marketplace/sharing?

Future feature - users could:
- Export skills as .zip
- Import from URL
- Browse community skills

---

## File Structure After Implementation

### New Files
```
apps/web/src/
├── stores/
│   └── skills-store.ts
├── components/editor/media-panel/
│   └── views/
│       └── skills.tsx
│   └── skill-card.tsx
│   └── import-skill-dialog.tsx
└── types/
    └── skill.ts
```

### Modified Files
```
apps/web/src/
├── components/editor/media-panel/
│   ├── store.ts              # Add "skills" tab
│   └── index.tsx             # Add SkillsView to viewMap
├── lib/storage/
│   ├── types.ts              # Add SkillData
│   └── storage-service.ts    # Add skill operations
└── electron/
    └── skill-handler.ts      # File operations for skills
```

---

## Implementation Phases

### Phase 1: Read-Only View
- Display skills from project folder
- Show name, description, files
- No editing, no running

### Phase 2: Import & Delete
- Import from .claude/skills
- Import from any folder
- Delete skill from project

### Phase 3: Gemini Integration
- "Run with Gemini" button
- Send skill context to terminal
- Skill-aware prompts

### Phase 4: Skill Editing (Optional)
- In-app markdown viewer/editor
- Create new skill wizard
- Dependency management

---

## Success Criteria

1. ✅ Skills tab visible in media panel
2. ✅ Project skills displayed with name/description
3. ✅ Can import skill from .claude/skills folder
4. ✅ Can delete skill from project
5. ✅ Skills persist with project (survives reload)
6. ✅ Can run skill via Gemini terminal
7. ✅ Project folder is self-contained (portable)

---

## Open Questions

1. Should skills be version controlled separately?
2. How to handle skill dependencies (pip install)?
3. Should skills have access to project media?
4. Multi-step skill workflows?
