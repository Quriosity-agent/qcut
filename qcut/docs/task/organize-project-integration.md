# QCut Organize-Project Skill Integration

**Feature Branch:** `feature/organize-project-integration`
**Priority:** High (includes critical bug fix)
**Estimated Total Time:** ~6 hours

---

## Executive Summary

Integrate the organize-project skill into QCut's core functionality, enabling users to:
1. Automatically organize media into proper folder structure
2. Detect and clean up unused media
3. Initialize new projects with standard folder structure
4. Perform bulk operations on media items

**Critical Finding:** Media folder assignments are NOT persisted to storage - this must be fixed first.

---

## Current State Analysis

### What Exists
- Virtual folder system with CRUD operations (`folder-store.ts`)
- Folder hierarchy with max 3 levels depth
- Media-to-folder assignment methods (in-memory only)
- Folder persistence to IndexedDB
- Default folder ID constants (`default-videos`, `default-audio`, etc.)

### What's Missing
1. **Media folder persistence** - `folderIds` not saved to storage (BUG)
2. **Auto-organize feature** - Automatically categorize media by type
3. **Bulk operations** - Move/assign multiple items at once
4. **Unused media detection** - Find media not on timeline
5. **Project setup wizard** - Initialize folder structure on project creation
6. **Cleanup utilities** - Remove temp files, broken symlinks, unused media

---

## Implementation Subtasks

### Subtask 1: Fix Media Folder Persistence (CRITICAL) - 45 min

**Problem:** Media folder assignments (`folderIds`) are updated in memory but not persisted to IndexedDB. On page reload, all folder assignments are lost.

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

### Subtask 2: Add Default Folder Auto-Creation - 30 min

**Goal:** When loading a project, automatically create default folders if they don't exist.

**Files to Modify:**
- `apps/web/src/stores/folder-store.ts`

**Add Method:**
```typescript
initializeDefaultFolders: async (projectId: string) => {
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
    // Persist new folders
  }
}
```

**Integration Point:**
- Call from `project-store.ts` in `setActiveProject()` or `loadProject()`

**Related Files:**
- `apps/web/src/stores/folder-store.ts`
- `apps/web/src/stores/media-store-types.ts:32-37` (DEFAULT_FOLDER_IDS)
- `apps/web/src/stores/project-store.ts`

---

### Subtask 3: Add Auto-Organize Media Feature - 1 hour

**Goal:** Add a button/action that automatically assigns media to folders based on type.

**Files to Create:**
- `apps/web/src/lib/media-organizer.ts`

**Implementation:**
```typescript
export interface OrganizeResult {
  moved: { mediaId: string; folderId: string; name: string }[];
  skipped: { mediaId: string; reason: string }[];
  errors: { mediaId: string; error: string }[];
}

export async function autoOrganizeMedia(
  mediaItems: MediaItem[],
  folders: MediaFolder[]
): Promise<OrganizeResult> {
  const result: OrganizeResult = { moved: [], skipped: [], errors: [] };

  const typeToFolder: Record<string, string> = {
    video: DEFAULT_FOLDER_IDS.VIDEOS,
    audio: DEFAULT_FOLDER_IDS.AUDIO,
    image: DEFAULT_FOLDER_IDS.IMAGES,
  };

  for (const item of mediaItems) {
    // Skip if already organized
    if (item.folderIds && item.folderIds.length > 0) {
      result.skipped.push({ mediaId: item.id, reason: "Already in folder" });
      continue;
    }

    // Skip AI-generated (handle separately)
    if (item.metadata?.source) {
      const folderId = DEFAULT_FOLDER_IDS.AI_GENERATED;
      result.moved.push({ mediaId: item.id, folderId, name: item.name });
      continue;
    }

    const targetFolder = typeToFolder[item.type];
    if (targetFolder) {
      result.moved.push({ mediaId: item.id, folderId: targetFolder, name: item.name });
    }
  }

  return result;
}
```

**Files to Modify:**
- `apps/web/src/stores/media-store.ts` - Add `organizeAllMedia()` method
- `apps/web/src/components/editor/media-panel/views/media.tsx` - Add "Organize" button

**UI Integration:**
```tsx
// Add to media panel header
<Button
  variant="outline"
  size="sm"
  onClick={handleOrganizeMedia}
>
  <Wand2 className="h-4 w-4 mr-1" />
  Auto-Organize
</Button>
```

**Related Files:**
- `apps/web/src/lib/media-organizer.ts` (NEW)
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/components/editor/media-panel/views/media.tsx`

---

### Subtask 4: Add Bulk Folder Assignment - 45 min

**Goal:** Allow selecting multiple media items and assigning them to a folder at once.

**Files to Modify:**
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/components/editor/media-panel/views/media.tsx`

**Add to media-store.ts:**
```typescript
// Bulk operations
bulkAddToFolder: (mediaIds: string[], folderId: string) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      mediaIds.includes(item.id)
        ? { ...item, folderIds: [...new Set([...(item.folderIds || []), folderId])] }
        : item
    ),
  }));
  // Persist all changed items
},

bulkRemoveFromFolder: (mediaIds: string[], folderId: string) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      mediaIds.includes(item.id)
        ? { ...item, folderIds: (item.folderIds || []).filter(id => id !== folderId) }
        : item
    ),
  }));
},

bulkMoveToFolder: (mediaIds: string[], folderId: string | null) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      mediaIds.includes(item.id)
        ? { ...item, folderIds: folderId ? [folderId] : [] }
        : item
    ),
  }));
},
```

**UI Changes:**
- Add multi-select mode with checkboxes
- Show bulk action toolbar when items selected
- Context menu on selection for folder assignment

**Related Files:**
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/stores/media-store-types.ts` (update MediaStore type)
- `apps/web/src/components/editor/media-panel/views/media.tsx`
- `apps/web/src/components/editor/media-panel/media-grid-item.tsx` (add checkbox)

---

### Subtask 5: Add Unused Media Detection - 1 hour

**Goal:** Find and highlight media items not used on any timeline.

**Files to Create:**
- `apps/web/src/lib/media-usage-analyzer.ts`

**Implementation:**
```typescript
export interface MediaUsageReport {
  used: { id: string; usageCount: number; tracks: string[] }[];
  unused: { id: string; name: string; type: string; size?: number }[];
  totalUsed: number;
  totalUnused: number;
}

export function analyzeMediaUsage(
  mediaItems: MediaItem[],
  timelineTracks: TimelineTrack[]
): MediaUsageReport {
  const usageMap = new Map<string, { count: number; tracks: string[] }>();

  // Scan all timeline elements for media references
  for (const track of timelineTracks) {
    for (const element of track.elements) {
      if (element.mediaId) {
        const existing = usageMap.get(element.mediaId) || { count: 0, tracks: [] };
        existing.count++;
        if (!existing.tracks.includes(track.id)) {
          existing.tracks.push(track.id);
        }
        usageMap.set(element.mediaId, existing);
      }
    }
  }

  const used: MediaUsageReport['used'] = [];
  const unused: MediaUsageReport['unused'] = [];

  for (const item of mediaItems) {
    const usage = usageMap.get(item.id);
    if (usage) {
      used.push({ id: item.id, usageCount: usage.count, tracks: usage.tracks });
    } else {
      unused.push({ id: item.id, name: item.name, type: item.type });
    }
  }

  return {
    used,
    unused,
    totalUsed: used.length,
    totalUnused: unused.length,
  };
}
```

**Files to Modify:**
- `apps/web/src/stores/media-store.ts` - Add usage state
- `apps/web/src/components/editor/media-panel/views/media.tsx` - Add filter/visual indicator

**UI Integration:**
- Add "Show Unused" filter toggle
- Visual badge on unused media (e.g., dimmed or "Unused" label)
- "Clean Up Unused" button in menu

**Related Files:**
- `apps/web/src/lib/media-usage-analyzer.ts` (NEW)
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/stores/timeline-store.ts` (read track data)
- `apps/web/src/components/editor/media-panel/views/media.tsx`

---

### Subtask 6: Add Project Cleanup Dialog - 1 hour

**Goal:** Create a dialog/modal for cleaning up project files.

**Files to Create:**
- `apps/web/src/components/editor/media-panel/cleanup-dialog.tsx`

**Dialog Features:**
1. **Unused Media** - List and optionally delete
2. **Temp Files** - Show size, option to clear
3. **Cache Files** - Show size, option to clear
4. **Broken Symlinks** - Detect and offer to re-link or remove
5. **Duplicate Detection** - Find potential duplicates by size/name

**UI Component:**
```tsx
export function CleanupDialog({ open, onClose }: CleanupDialogProps) {
  const [analysis, setAnalysis] = useState<CleanupAnalysis | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project Cleanup</DialogTitle>
          <DialogDescription>
            Analyze and clean up your project to save space and improve performance.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="unused">
          <TabsList>
            <TabsTrigger value="unused">Unused Media ({analysis?.unusedCount})</TabsTrigger>
            <TabsTrigger value="temp">Temp Files</TabsTrigger>
            <TabsTrigger value="symlinks">Broken Links</TabsTrigger>
          </TabsList>

          <TabsContent value="unused">
            {/* List unused media with checkboxes */}
          </TabsContent>

          <TabsContent value="temp">
            {/* Temp file cleanup options */}
          </TabsContent>

          <TabsContent value="symlinks">
            {/* Broken symlink detection and repair */}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleCleanup}>
            Clean Up Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Related Files:**
- `apps/web/src/components/editor/media-panel/cleanup-dialog.tsx` (NEW)
- `apps/web/src/lib/media-usage-analyzer.ts`
- `apps/web/src/components/editor/media-panel/views/media.tsx` (add menu item)

---

### Subtask 7: Add Unit Tests - 1 hour

**Files to Create:**
- `apps/web/src/lib/__tests__/media-organizer.test.ts`
- `apps/web/src/lib/__tests__/media-usage-analyzer.test.ts`
- `apps/web/src/stores/__tests__/folder-persistence.test.ts`

**Test Coverage:**

**media-organizer.test.ts:**
- Auto-organize by media type
- Skip already-organized items
- Handle AI-generated content
- Handle mixed media types

**media-usage-analyzer.test.ts:**
- Detect used media on timeline
- Detect unused media
- Handle multi-track usage
- Handle empty timeline

**folder-persistence.test.ts:**
- Folder assignment persists on reload
- Bulk operations persist correctly
- Default folders created on project init

**Related Files:**
- `apps/web/src/lib/__tests__/media-organizer.test.ts` (NEW)
- `apps/web/src/lib/__tests__/media-usage-analyzer.test.ts` (NEW)
- `apps/web/src/stores/__tests__/folder-persistence.test.ts` (NEW)

---

## Implementation Order

| Order | Subtask | Priority | Est. Time | Dependencies |
|-------|---------|----------|-----------|--------------|
| 1 | Fix Media Folder Persistence | CRITICAL | 45 min | None |
| 2 | Add Default Folder Auto-Creation | High | 30 min | #1 |
| 3 | Add Auto-Organize Feature | High | 1 hour | #1, #2 |
| 4 | Add Bulk Folder Assignment | Medium | 45 min | #1 |
| 5 | Add Unused Media Detection | Medium | 1 hour | None |
| 6 | Add Project Cleanup Dialog | Medium | 1 hour | #5 |
| 7 | Add Unit Tests | High | 1 hour | All |

**Total Estimated Time:** ~6 hours

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/web/src/lib/media-organizer.ts` | Auto-organize logic |
| `apps/web/src/lib/media-usage-analyzer.ts` | Usage detection |
| `apps/web/src/components/editor/media-panel/cleanup-dialog.tsx` | Cleanup UI |
| `apps/web/src/lib/__tests__/media-organizer.test.ts` | Tests |
| `apps/web/src/lib/__tests__/media-usage-analyzer.test.ts` | Tests |
| `apps/web/src/stores/__tests__/folder-persistence.test.ts` | Tests |

### Modified Files
| File | Changes |
|------|---------|
| `apps/web/src/stores/media-store.ts` | Add persistence to folder ops, bulk methods |
| `apps/web/src/stores/folder-store.ts` | Add initializeDefaultFolders |
| `apps/web/src/stores/project-store.ts` | Call folder init on project load |
| `apps/web/src/components/editor/media-panel/views/media.tsx` | Add organize button, unused filter |
| `apps/web/src/components/editor/media-panel/media-grid-item.tsx` | Add multi-select checkbox |

---

## Success Criteria

1. ✅ Media folder assignments persist across page reloads
2. ✅ Default folders created automatically for new projects
3. ✅ Auto-organize button categorizes media by type
4. ✅ Bulk operations work for multiple selected items
5. ✅ Unused media detection identifies items not on timeline
6. ✅ Cleanup dialog allows removing unused media
7. ✅ Unit test coverage > 80% for new functionality
8. ✅ No regression in existing folder/media functionality

---

## Future Enhancements

1. **Smart Folders** - Auto-updating folders based on rules (e.g., "All videos > 1 min")
2. **Folder Templates** - Save and apply folder structures
3. **Storage Dashboard** - Visual breakdown of project storage usage
4. **Media Deduplication** - Find and merge duplicate files
5. **Project Archive** - Export project with all media to ZIP
