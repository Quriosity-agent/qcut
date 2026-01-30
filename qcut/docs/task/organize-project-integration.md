# QCut Organize-Project Skill Integration

**Feature Branch:** `feature/organize-project-integration`
**Priority:** High (includes critical bug fix)
**Estimated Total Time:** ~3.5 hours

---

## Executive Summary

Integrate the organize-project skill into QCut as a **bundled skill** (like `ai-content-pipeline` and `ffmpeg-skill`) that Claude Code can use, while also fixing critical infrastructure issues in QCut to properly support the skill's functionality.

### Two-Part Integration:

1. **Skill Bundling** - Add organize-project to bundled skills so it's available in every project
2. **Infrastructure Fixes** - Fix QCut bugs/gaps that would prevent the skill from working properly

---

## Current State

### Existing Skills Pattern
```
.claude/skills/                    # Source skills (development)
├── ai-content-pipeline/
├── ffmpeg-skill/
└── organize-project/              # ✅ Already exists

resources/default-skills/          # Bundled skills (distributed with app)
├── ai-content-pipeline/           # ✅ Synced via scripts/sync-skills.ts
└── ffmpeg-skill/                  # ✅ Synced via scripts/sync-skills.ts
                                   # ❌ organize-project NOT synced yet
```

### Critical Bug Found
Media folder assignments (`folderIds`) are NOT persisted to storage - on page reload, all folder assignments are lost. The skill relies on folder organization working correctly.

---

## Implementation Subtasks

### Subtask 1: Bundle organize-project Skill - 15 min

**Goal:** Add organize-project to the bundled skills so it's available in every QCut project.

**Files to Modify:**
- `scripts/sync-skills.ts`

**Current sync-skills.ts behavior:**
- Syncs from `.claude/skills/` → `resources/default-skills/`
- Currently only syncs `ai-content-pipeline` and `ffmpeg-skill`

**Changes needed:**
```typescript
// Add organize-project to the skills list
const SKILLS_TO_SYNC = [
  'ai-content-pipeline',
  'ffmpeg-skill',
  'organize-project',  // ADD THIS
];
```

**Verification:**
- Run `bun run sync-skills`
- Confirm `resources/default-skills/organize-project/` exists with SKILL.md and REFERENCE.md

**Related Files:**
- `scripts/sync-skills.ts`
- `.claude/skills/organize-project/SKILL.md`
- `.claude/skills/organize-project/REFERENCE.md`
- `resources/default-skills/` (output directory)

---

### Subtask 2: Fix Media Folder Persistence (CRITICAL) - 45 min

**Problem:** Media folder assignments (`folderIds`) are updated in memory but not persisted to IndexedDB. On page reload, all folder assignments are lost. This breaks the skill's ability to organize media.

**Files to Modify:**
- `apps/web/src/stores/media-store.ts`

**Implementation:**
```typescript
// In addToFolder method - add persistence call
addToFolder: (mediaId: string, folderId: string) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      item.id === mediaId
        ? { ...item, folderIds: [...(item.folderIds || []), folderId].filter((v, i, a) => a.indexOf(v) === i) }
        : item
    ),
  }));

  // ADD: Persist the change
  const { mediaItems } = get();
  const item = mediaItems.find(m => m.id === mediaId);
  if (item) {
    const projectId = useProjectStore.getState().activeProject?.id;
    if (projectId) {
      storageService.saveMediaItem(projectId, item);
    }
  }
},
```

**Apply same pattern to:**
- `removeFromFolder`
- `moveToFolder`

**Test Cases:**
- Assign media to folder → Reload page → Verify folder assignment persists
- Remove media from folder → Reload page → Verify removal persists
- Move media to different folder → Reload page → Verify new assignment

**Related Files:**
- `apps/web/src/stores/media-store.ts:118-152` (addToFolder, removeFromFolder, moveToFolder)
- `apps/web/src/lib/storage/storage-service.ts:314` (folderIds serialization)

---

### Subtask 3: Add Default Folder Auto-Creation - 30 min

**Goal:** When loading a project, automatically create default folders if they don't exist. This enables the skill to organize media into standard folders.

**Files to Modify:**
- `apps/web/src/stores/folder-store.ts`

**Add Method:**
```typescript
initializeDefaultFolders: async () => {
  const { folders } = get();

  const defaultFolders = [
    { id: DEFAULT_FOLDER_IDS.VIDEOS, name: "Videos", color: "#3b82f6" },
    { id: DEFAULT_FOLDER_IDS.AUDIO, name: "Audio", color: "#22c55e" },
    { id: DEFAULT_FOLDER_IDS.IMAGES, name: "Images", color: "#f59e0b" },
    { id: DEFAULT_FOLDER_IDS.AI_GENERATED, name: "AI Generated", color: "#a855f7" },
  ];

  const newFolders: MediaFolder[] = [];
  for (const def of defaultFolders) {
    if (!folders.find(f => f.id === def.id)) {
      newFolders.push({
        id: def.id,
        name: def.name,
        parentId: null,
        color: def.color,
        isExpanded: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  if (newFolders.length > 0) {
    set((state) => ({ folders: [...state.folders, ...newFolders] }));
    // Trigger persistence
  }
}
```

**Integration Point:**
- Call from `folder-store.ts` in `loadFolders()` after loading existing folders
- Or call from `project-store.ts` in `setActiveProject()`

**Related Files:**
- `apps/web/src/stores/folder-store.ts`
- `apps/web/src/stores/media-store-types.ts:32-37` (DEFAULT_FOLDER_IDS)
- `apps/web/src/stores/project-store.ts`

---

### Subtask 4: Add Bulk Folder Assignment Methods - 45 min

**Goal:** Add methods that the skill can leverage (via UI or future API) for bulk operations.

**Files to Modify:**
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/stores/media-store-types.ts`

**Add to media-store.ts:**
```typescript
// Bulk operations for skill/automation use
bulkAddToFolder: (mediaIds: string[], folderId: string) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      mediaIds.includes(item.id)
        ? { ...item, folderIds: [...new Set([...(item.folderIds || []), folderId])] }
        : item
    ),
  }));

  // Persist all changed items
  const { mediaItems } = get();
  const projectId = useProjectStore.getState().activeProject?.id;
  if (projectId) {
    const changedItems = mediaItems.filter(m => mediaIds.includes(m.id));
    for (const item of changedItems) {
      storageService.saveMediaItem(projectId, item);
    }
  }
},

bulkMoveToFolder: (mediaIds: string[], folderId: string | null) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      mediaIds.includes(item.id)
        ? { ...item, folderIds: folderId ? [folderId] : [] }
        : item
    ),
  }));
  // Persist changes
},

// Auto-organize all unorganized media by type
autoOrganizeByType: () => {
  const { mediaItems } = get();

  const typeToFolder: Record<string, string> = {
    video: DEFAULT_FOLDER_IDS.VIDEOS,
    audio: DEFAULT_FOLDER_IDS.AUDIO,
    image: DEFAULT_FOLDER_IDS.IMAGES,
  };

  set((state) => ({
    mediaItems: state.mediaItems.map((item) => {
      // Skip if already organized
      if (item.folderIds && item.folderIds.length > 0) return item;

      // AI-generated goes to AI folder
      if (item.metadata?.source) {
        return { ...item, folderIds: [DEFAULT_FOLDER_IDS.AI_GENERATED] };
      }

      // Organize by type
      const targetFolder = typeToFolder[item.type];
      if (targetFolder) {
        return { ...item, folderIds: [targetFolder] };
      }

      return item;
    }),
  }));

  // Persist all changes
},
```

**Update MediaStore type:**
```typescript
// In media-store-types.ts
export type MediaStore = {
  // ... existing methods
  bulkAddToFolder: (mediaIds: string[], folderId: string) => void;
  bulkMoveToFolder: (mediaIds: string[], folderId: string | null) => void;
  autoOrganizeByType: () => void;
};
```

**Related Files:**
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/stores/media-store-types.ts`
- `apps/web/src/stores/media-store-types.ts:32-37` (DEFAULT_FOLDER_IDS)

---

### Subtask 5: Add Unit Tests - 1 hour

**Files to Create:**
- `apps/web/src/stores/__tests__/folder-persistence.test.ts`
- `apps/web/src/stores/__tests__/auto-organize.test.ts`

**Test Coverage:**

**folder-persistence.test.ts:**
```typescript
describe("Media Folder Persistence", () => {
  it("should persist folder assignment on addToFolder");
  it("should persist folder removal on removeFromFolder");
  it("should persist folder change on moveToFolder");
  it("should persist bulk folder assignments");
});
```

**auto-organize.test.ts:**
```typescript
describe("Auto-Organize Media", () => {
  it("should organize videos to Videos folder");
  it("should organize audio to Audio folder");
  it("should organize images to Images folder");
  it("should organize AI-generated to AI Generated folder");
  it("should skip already-organized media");
  it("should create default folders if missing");
});
```

**Related Files:**
- `apps/web/src/stores/__tests__/folder-persistence.test.ts` (NEW)
- `apps/web/src/stores/__tests__/auto-organize.test.ts` (NEW)

---

## Implementation Order

| Order | Subtask | Priority | Est. Time | Dependencies |
|-------|---------|----------|-----------|--------------|
| 1 | Bundle organize-project Skill | High | 15 min | None |
| 2 | Fix Media Folder Persistence | CRITICAL | 45 min | None |
| 3 | Add Default Folder Auto-Creation | High | 30 min | #2 |
| 4 | Add Bulk Folder Assignment | High | 45 min | #2 |
| 5 | Add Unit Tests | High | 1 hour | #2, #3, #4 |

**Total Estimated Time:** ~3.5 hours

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `resources/default-skills/organize-project/` | Bundled skill (synced from .claude/skills/) |
| `apps/web/src/stores/__tests__/folder-persistence.test.ts` | Persistence tests |
| `apps/web/src/stores/__tests__/auto-organize.test.ts` | Auto-organize tests |

### Modified Files
| File | Changes |
|------|---------|
| `scripts/sync-skills.ts` | Add organize-project to sync list |
| `apps/web/src/stores/media-store.ts` | Add persistence to folder ops, bulk methods, autoOrganize |
| `apps/web/src/stores/media-store-types.ts` | Add new method types |
| `apps/web/src/stores/folder-store.ts` | Add initializeDefaultFolders |

---

## How the Skill Works

Once integrated, the organize-project skill will be available in QCut's Skills panel:

1. **User clicks "Run" on organize-project skill** → Opens Claude Code terminal
2. **Claude Code reads the skill** → Understands QCut's folder structure
3. **Claude analyzes the project** → Scans media items, identifies organization needs
4. **Claude provides recommendations** → Suggests folder assignments, cleanup actions
5. **User approves** → Claude executes organization commands
6. **QCut persists changes** → Folder assignments saved to IndexedDB

The skill leverages:
- Virtual folder system (already exists)
- `autoOrganizeByType()` method (new)
- `bulkMoveToFolder()` method (new)
- Default folder IDs (already exist)

---

## Success Criteria

1. ✅ organize-project skill appears in Skills panel for all projects
2. ✅ Media folder assignments persist across page reloads
3. ✅ Default folders (Videos, Audio, Images, AI Generated) auto-created
4. ✅ Bulk folder operations work correctly
5. ✅ `autoOrganizeByType()` correctly categorizes media
6. ✅ Unit test coverage > 80% for new functionality
7. ✅ Skill works correctly when run via Claude Code

---

## Future Enhancements

1. **Expose API to skill** - Allow skill to call QCut methods directly via IPC
2. **Organize button in UI** - Quick access without running full skill
3. **Smart folders** - Auto-updating folders based on rules
4. **Unused media detection** - Skill can identify and suggest cleanup
