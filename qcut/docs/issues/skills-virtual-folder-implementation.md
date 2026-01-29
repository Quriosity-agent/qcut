# Skills as Virtual Folder - Implementation Plan

**Feature:** Skills displayed as special folder in Media Panel (Option A)
**Branch:** `feature/skills-in-media-panel`
**Priority:** Medium
**Estimated Effort:** Large (7 subtasks)

---

## Overview

Integrate AI skills into the existing virtual folder system. Skills appear as a special "Skills" folder in the media panel sidebar, leveraging the folder infrastructure we just built.

---

## Architecture: Option A - Skills in Virtual Folders

```
Media Panel
├── 📁 All Media
├── 📁 Scene 1
├── 📁 Audio
├── 🧠 Skills                 ← Special system folder
│   ├── 📄 AI Content Pipeline
│   ├── 📄 FFmpeg Skill
│   └── 📄 Custom Skill
```

### Why Option A?
- Leverages existing virtual folder UI (already built)
- Unified navigation experience
- Skills are contextual to project
- Less new UI code to write

---

## Data Model

### Skill Interface
```typescript
// apps/web/src/types/skill.ts

/**
 * Skill metadata parsed from Skill.md frontmatter.
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  dependencies?: string;          // e.g., "python>=3.10", "ffmpeg"
  folderName: string;             // folder name in project/skills/
  mainFile: string;               // typically "Skill.md"
  additionalFiles: string[];      // ["REFERENCE.md", "CONCEPTS.md"]
  content: string;                // Full markdown content
  createdAt: number;
  updatedAt: number;
}

/**
 * Skill frontmatter from YAML header.
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  dependencies?: string;
}
```

### Project Structure
```
Documents/QCut/Projects/MyProject/
├── project.qcut
├── media/
│   ├── imported/
│   └── generated/
├── skills/                       ← NEW: Project skills folder
│   ├── ai-content-pipeline/
│   │   ├── Skill.md
│   │   └── REFERENCE.md
│   └── ffmpeg-skill/
│       ├── Skill.md
│       ├── REFERENCE.md
│       ├── CONCEPTS.md
│       └── ADVANCED.md
└── cache/
```

---

## Implementation Tasks

### Task 1: Define Skill Types & Constants
**Estimated time:** 15 min
**Files to create:**
- `apps/web/src/types/skill.ts`

**Files to modify:**
- `apps/web/src/stores/media-store-types.ts` (add SKILLS_FOLDER_ID constant)

**Implementation:**
```typescript
// types/skill.ts
export interface Skill {
  id: string;
  name: string;
  description: string;
  dependencies?: string;
  folderName: string;
  mainFile: string;
  additionalFiles: string[];
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  dependencies?: string;
}

// Parse frontmatter from Skill.md content
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const lines = yaml.split('\n');
  const result: Record<string, string> = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length) {
      result[key.trim()] = valueParts.join(':').trim();
    }
  }

  return {
    name: result.name || 'Unnamed Skill',
    description: result.description || '',
    dependencies: result.dependencies,
  };
}
```

```typescript
// media-store-types.ts - add constant
export const SKILLS_FOLDER_ID = 'system-skills-folder';
```

---

### Task 2: Create Skills Store
**Estimated time:** 35 min
**Files to create:**
- `apps/web/src/stores/skills-store.ts`
- `apps/web/src/stores/__tests__/skills-store.test.ts`

**Implementation:**
```typescript
// skills-store.ts
import { create } from "zustand";
import type { Skill } from "@/types/skill";

interface SkillsState {
  skills: Skill[];
  selectedSkillId: string | null;
  isLoading: boolean;
  error: string | null;
}

interface SkillsActions {
  // CRUD
  loadSkills: (projectId: string) => Promise<void>;
  importSkill: (projectId: string, sourcePath: string) => Promise<string | null>;
  deleteSkill: (projectId: string, skillId: string) => Promise<void>;

  // Queries
  getSkillById: (id: string) => Skill | undefined;

  // UI State
  setSelectedSkill: (id: string | null) => void;
  clearSkills: () => void;
}

type SkillsStore = SkillsState & SkillsActions;

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  selectedSkillId: null,
  isLoading: false,
  error: null,

  loadSkills: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      // Load via Electron IPC
      if (window.electronAPI?.skills?.list) {
        const skills = await window.electronAPI.skills.list(projectId);
        set({ skills, isLoading: false });
      } else {
        set({ skills: [], isLoading: false });
      }
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  importSkill: async (projectId, sourcePath) => {
    try {
      if (window.electronAPI?.skills?.import) {
        const skill = await window.electronAPI.skills.import(projectId, sourcePath);
        if (skill) {
          set((state) => ({ skills: [...state.skills, skill] }));
          return skill.id;
        }
      }
      return null;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  deleteSkill: async (projectId, skillId) => {
    try {
      if (window.electronAPI?.skills?.delete) {
        await window.electronAPI.skills.delete(projectId, skillId);
        set((state) => ({
          skills: state.skills.filter((s) => s.id !== skillId),
          selectedSkillId: state.selectedSkillId === skillId ? null : state.selectedSkillId,
        }));
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  getSkillById: (id) => get().skills.find((s) => s.id === id),

  setSelectedSkill: (id) => set({ selectedSkillId: id }),

  clearSkills: () => set({ skills: [], selectedSkillId: null, error: null }),
}));
```

**Unit Tests:**
```typescript
// __tests__/skills-store.test.ts
describe("SkillsStore", () => {
  it("clears skills and resets state");
  it("sets selected skill");
  it("gets skill by id");
});
```

---

### Task 3: Create Electron Skills Handler
**Estimated time:** 40 min
**Files to create:**
- `electron/skills-handler.ts`

**Files to modify:**
- `electron/main.ts` (register IPC handlers)
- `electron/preload.ts` (expose skills API)
- `apps/web/src/types/electron.d.ts` (type definitions)

**Implementation:**
```typescript
// electron/skills-handler.ts
import { ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { app } from "electron";

interface Skill {
  id: string;
  name: string;
  description: string;
  dependencies?: string;
  folderName: string;
  mainFile: string;
  additionalFiles: string[];
  content: string;
  createdAt: number;
  updatedAt: number;
}

function getProjectSkillsPath(projectId: string): string {
  const documentsPath = app.getPath("documents");
  return path.join(documentsPath, "QCut", "Projects", projectId, "skills");
}

function parseSkillFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, string> = {};

  for (const line of yaml.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      result[key] = value;
    }
  }

  return {
    name: result.name || 'Unnamed Skill',
    description: result.description || '',
    dependencies: result.dependencies,
  };
}

export function registerSkillsHandlers() {
  // List all skills in project
  ipcMain.handle("skills:list", async (_, projectId: string): Promise<Skill[]> => {
    const skillsPath = getProjectSkillsPath(projectId);

    try {
      await fs.access(skillsPath);
    } catch {
      // Skills folder doesn't exist yet
      return [];
    }

    const entries = await fs.readdir(skillsPath, { withFileTypes: true });
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFolder = path.join(skillsPath, entry.name);
      const skillMdPath = path.join(skillFolder, "Skill.md");

      try {
        const content = await fs.readFile(skillMdPath, "utf-8");
        const frontmatter = parseSkillFrontmatter(content);
        if (!frontmatter) continue;

        // Get additional files
        const files = await fs.readdir(skillFolder);
        const additionalFiles = files.filter(f => f !== "Skill.md" && f.endsWith(".md"));

        const stat = await fs.stat(skillMdPath);

        skills.push({
          id: entry.name,
          name: frontmatter.name,
          description: frontmatter.description,
          dependencies: frontmatter.dependencies,
          folderName: entry.name,
          mainFile: "Skill.md",
          additionalFiles,
          content,
          createdAt: stat.birthtimeMs,
          updatedAt: stat.mtimeMs,
        });
      } catch {
        // Skip invalid skill folders
      }
    }

    return skills;
  });

  // Import skill from source path
  ipcMain.handle("skills:import", async (_, projectId: string, sourcePath: string): Promise<Skill | null> => {
    const skillsPath = getProjectSkillsPath(projectId);
    const folderName = path.basename(sourcePath);
    const destPath = path.join(skillsPath, folderName);

    // Ensure skills directory exists
    await fs.mkdir(skillsPath, { recursive: true });

    // Copy entire skill folder
    await fs.cp(sourcePath, destPath, { recursive: true });

    // Read and parse the skill
    const skillMdPath = path.join(destPath, "Skill.md");
    const content = await fs.readFile(skillMdPath, "utf-8");
    const frontmatter = parseSkillFrontmatter(content);

    if (!frontmatter) return null;

    const files = await fs.readdir(destPath);
    const additionalFiles = files.filter(f => f !== "Skill.md" && f.endsWith(".md"));
    const stat = await fs.stat(skillMdPath);

    return {
      id: folderName,
      name: frontmatter.name,
      description: frontmatter.description,
      dependencies: frontmatter.dependencies,
      folderName,
      mainFile: "Skill.md",
      additionalFiles,
      content,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
    };
  });

  // Delete skill
  ipcMain.handle("skills:delete", async (_, projectId: string, skillId: string): Promise<void> => {
    const skillPath = path.join(getProjectSkillsPath(projectId), skillId);
    await fs.rm(skillPath, { recursive: true, force: true });
  });

  // Get skill content
  ipcMain.handle("skills:getContent", async (_, projectId: string, skillId: string, filename: string): Promise<string> => {
    const filePath = path.join(getProjectSkillsPath(projectId), skillId, filename);
    return fs.readFile(filePath, "utf-8");
  });

  // Browse for skill folders (opens dialog)
  ipcMain.handle("skills:browse", async (): Promise<string | null> => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Skill Folder",
    });

    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}
```

**Update electron/main.ts:**
```typescript
import { registerSkillsHandlers } from "./skills-handler";
// In app.whenReady():
registerSkillsHandlers();
```

**Update electron/preload.ts:**
```typescript
skills: {
  list: (projectId: string) => ipcRenderer.invoke("skills:list", projectId),
  import: (projectId: string, sourcePath: string) => ipcRenderer.invoke("skills:import", projectId, sourcePath),
  delete: (projectId: string, skillId: string) => ipcRenderer.invoke("skills:delete", projectId, skillId),
  getContent: (projectId: string, skillId: string, filename: string) => ipcRenderer.invoke("skills:getContent", projectId, skillId, filename),
  browse: () => ipcRenderer.invoke("skills:browse"),
},
```

**Update electron.d.ts:**
```typescript
interface ElectronAPI {
  // ... existing ...
  skills?: {
    list: (projectId: string) => Promise<Skill[]>;
    import: (projectId: string, sourcePath: string) => Promise<Skill | null>;
    delete: (projectId: string, skillId: string) => Promise<void>;
    getContent: (projectId: string, skillId: string, filename: string) => Promise<string>;
    browse: () => Promise<string | null>;
  };
}
```

---

### Task 4: Add Skills Folder to Folder Tree
**Estimated time:** 25 min
**Files to modify:**
- `apps/web/src/components/editor/media-panel/folder-tree.tsx`
- `apps/web/src/stores/folder-store.ts` (optional: add system folder support)

**Changes to folder-tree.tsx:**
```tsx
import { useSkillsStore } from "@/stores/skills-store";
import { Brain } from "lucide-react"; // Skills icon
import { SKILLS_FOLDER_ID } from "@/stores/media-store-types";

export function FolderTree({ onFolderSelect }: FolderTreeProps) {
  const { skills } = useSkillsStore();
  const { selectedFolderId, setSelectedFolder, getChildFolders } = useFolderStore();

  // ... existing code ...

  return (
    <div className="flex flex-col h-full border-r border-border bg-panel-accent/30">
      {/* Header */}
      {/* ... */}

      <ScrollArea className="flex-1">
        <div className="p-1">
          {/* All Media */}
          <button ...>All Media</button>

          {/* User Folders */}
          {rootFolders.map((folder) => (
            <FolderItem key={folder.id} ... />
          ))}

          {/* Skills System Folder - Always at bottom */}
          <div className="mt-2 pt-2 border-t border-border">
            <button
              type="button"
              className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2 ${
                selectedFolderId === SKILLS_FOLDER_ID
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              }`}
              onClick={() => handleSelect(SKILLS_FOLDER_ID)}
            >
              <Brain className="h-4 w-4 text-purple-500" />
              <span>Skills</span>
              {skills.length > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {skills.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
```

---

### Task 5: Create Skills View Component
**Estimated time:** 45 min
**Files to create:**
- `apps/web/src/components/editor/media-panel/views/skills.tsx`
- `apps/web/src/components/editor/media-panel/skill-card.tsx`
- `apps/web/src/components/editor/media-panel/import-skill-dialog.tsx`

**skills.tsx:**
```tsx
"use client";

import { useEffect } from "react";
import { useSkillsStore } from "@/stores/skills-store";
import { useProjectStore } from "@/stores/project-store";
import { SkillCard } from "../skill-card";
import { ImportSkillDialog } from "../import-skill-dialog";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Brain } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

export function SkillsView() {
  const { skills, isLoading, loadSkills, deleteSkill } = useSkillsStore();
  const { activeProject } = useProjectStore();
  const [isImportOpen, setIsImportOpen] = useState(false);

  useEffect(() => {
    if (activeProject?.id) {
      loadSkills(activeProject.id);
    }
  }, [activeProject?.id, loadSkills]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <span className="font-medium">Skills</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsImportOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Import
        </Button>
      </div>

      {/* Skills List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {skills.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No skills in this project</p>
              <p className="text-xs mt-1">
                Import skills from .claude/skills folder
              </p>
            </div>
          ) : (
            skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onDelete={() => {
                  if (activeProject) {
                    deleteSkill(activeProject.id, skill.id);
                  }
                }}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <ImportSkillDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
    </div>
  );
}
```

**skill-card.tsx:**
```tsx
"use client";

import type { Skill } from "@/types/skill";
import { Button } from "@/components/ui/button";
import { Brain, Trash2, ExternalLink, Play } from "lucide-react";
import { useGeminiTerminalStore } from "@/stores/gemini-terminal-store";
import { useMediaPanelStore } from "../store";
import { toast } from "sonner";

interface SkillCardProps {
  skill: Skill;
  onDelete: () => void;
}

export function SkillCard({ skill, onDelete }: SkillCardProps) {
  const { addAttachment, setInputValue } = useGeminiTerminalStore();
  const { setActiveTab } = useMediaPanelStore();

  const handleRunWithGemini = () => {
    // Switch to Gemini tab
    setActiveTab("gemini");

    // Pre-fill with skill context
    setInputValue(`Use the ${skill.name} skill to help me with: `);

    toast.success(`${skill.name} ready in Gemini terminal`);
  };

  const handleDelete = () => {
    if (confirm(`Delete skill "${skill.name}" from this project?`)) {
      onDelete();
      toast.success(`Deleted "${skill.name}"`);
    }
  };

  return (
    <div className="border border-border rounded-lg p-3 bg-card hover:bg-accent/5 transition-colors">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-purple-500/10">
          <Brain className="h-5 w-5 text-purple-500" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{skill.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {skill.description}
          </p>

          {skill.dependencies && (
            <p className="text-xs text-muted-foreground mt-1">
              Requires: {skill.dependencies}
            </p>
          )}

          {skill.additionalFiles.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              +{skill.additionalFiles.length} reference files
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="flex-1"
          onClick={handleRunWithGemini}
        >
          <Play className="h-3 w-3 mr-1" />
          Run
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
```

**import-skill-dialog.tsx:**
```tsx
"use client";

import { useState, useEffect } from "react";
import { useSkillsStore } from "@/stores/skills-store";
import { useProjectStore } from "@/stores/project-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Folder, Brain } from "lucide-react";

interface ImportSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AvailableSkill {
  path: string;
  name: string;
  description: string;
}

export function ImportSkillDialog({ open, onOpenChange }: ImportSkillDialogProps) {
  const { importSkill } = useSkillsStore();
  const { activeProject } = useProjectStore();
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      // Scan .claude/skills for available skills
      scanGlobalSkills();
    }
  }, [open]);

  const scanGlobalSkills = async () => {
    // In a real implementation, this would scan .claude/skills
    // For now, we'll use a hardcoded list or browse dialog
    setAvailableSkills([]);
  };

  const handleBrowse = async () => {
    if (!window.electronAPI?.skills?.browse) {
      toast.error("Browse not available in browser mode");
      return;
    }

    const path = await window.electronAPI.skills.browse();
    if (path && activeProject) {
      setIsLoading(true);
      const skillId = await importSkill(activeProject.id, path);
      setIsLoading(false);

      if (skillId) {
        toast.success("Skill imported successfully");
        onOpenChange(false);
      } else {
        toast.error("Failed to import skill");
      }
    }
  };

  const handleImport = async (skillPath: string) => {
    if (!activeProject) return;

    setIsLoading(true);
    const skillId = await importSkill(activeProject.id, skillPath);
    setIsLoading(false);

    if (skillId) {
      toast.success("Skill imported successfully");
      onOpenChange(false);
    } else {
      toast.error("Failed to import skill");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Skill</DialogTitle>
          <DialogDescription>
            Import a skill folder into your project
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Available skills from .claude/skills */}
          {availableSkills.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Available Skills</h4>
              {availableSkills.map((skill) => (
                <button
                  key={skill.path}
                  type="button"
                  className="w-full p-3 border rounded-lg text-left hover:bg-accent/5"
                  onClick={() => handleImport(skill.path)}
                  disabled={isLoading}
                >
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-500" />
                    <span className="font-medium">{skill.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {skill.description}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* Browse button */}
          <div className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleBrowse}
              disabled={isLoading}
            >
              <Folder className="h-4 w-4 mr-2" />
              Browse for Skill Folder...
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Task 6: Update Media View to Show Skills
**Estimated time:** 20 min
**Files to modify:**
- `apps/web/src/components/editor/media-panel/views/media.tsx`

**Changes:**
When `selectedFolderId === SKILLS_FOLDER_ID`, render `<SkillsView />` instead of the media grid.

```tsx
import { SkillsView } from "./skills";
import { SKILLS_FOLDER_ID } from "@/stores/media-store-types";

export function MediaView() {
  // ... existing code ...

  const { selectedFolderId } = useFolderStore();

  // If Skills folder is selected, show SkillsView
  if (selectedFolderId === SKILLS_FOLDER_ID) {
    return (
      <div className="flex h-full">
        {/* Folder sidebar */}
        <div className="w-44 min-w-[140px] max-w-[200px] flex-shrink-0">
          <FolderTree />
        </div>

        {/* Skills content */}
        <div className="flex-1 flex flex-col min-w-0">
          <SkillsView />
        </div>
      </div>
    );
  }

  // ... rest of existing media view ...
}
```

---

### Task 7: Load Skills on Project Open
**Estimated time:** 15 min
**Files to modify:**
- `apps/web/src/routes/editor.$project_id.lazy.tsx` or equivalent project loader

**Changes:**
```typescript
import { useSkillsStore } from "@/stores/skills-store";

// In the editor component:
useEffect(() => {
  if (projectId) {
    useSkillsStore.getState().loadSkills(projectId);
  }
}, [projectId]);
```

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `types/skill.ts` | Skill interface and frontmatter parser |
| `stores/skills-store.ts` | Zustand store for skills |
| `stores/__tests__/skills-store.test.ts` | Unit tests |
| `electron/skills-handler.ts` | IPC handlers for file operations |
| `components/editor/media-panel/views/skills.tsx` | Skills list view |
| `components/editor/media-panel/skill-card.tsx` | Individual skill card |
| `components/editor/media-panel/import-skill-dialog.tsx` | Import dialog |

### Modified Files
| File | Changes |
|------|---------|
| `stores/media-store-types.ts` | Add SKILLS_FOLDER_ID constant |
| `components/editor/media-panel/folder-tree.tsx` | Add Skills system folder |
| `components/editor/media-panel/views/media.tsx` | Render SkillsView when Skills folder selected |
| `electron/main.ts` | Register skills handlers |
| `electron/preload.ts` | Expose skills API |
| `types/electron.d.ts` | Add skills API types |
| `routes/editor.$project_id.lazy.tsx` | Load skills on project open |

---

## Implementation Order

```
Task 1: Define Skill Types & Constants
    ↓
Task 2: Create Skills Store
    ↓
Task 3: Create Electron Skills Handler
    ↓
Task 4: Add Skills Folder to Folder Tree
    ↓
Task 5: Create Skills View Components
    ↓
Task 6: Update Media View to Show Skills
    ↓
Task 7: Load Skills on Project Open
```

---

## Success Criteria

1. ✅ Skills folder appears in folder tree sidebar
2. ✅ Clicking Skills folder shows skills list
3. ✅ Can import skill from file system (Electron only)
4. ✅ Can delete skill from project
5. ✅ Skills persist in project/skills/ folder
6. ✅ "Run" button opens Gemini terminal with skill context
7. ✅ Project is portable (skills travel with project)

---

## Future Enhancements

1. **Skill content viewer** - Show Skill.md content inline
2. **Reference file browser** - View REFERENCE.md, CONCEPTS.md
3. **Dependency checker** - Verify ffmpeg/python installed
4. **Skill marketplace** - Import from URL or community
5. **Skill templates** - Create new skill from template
