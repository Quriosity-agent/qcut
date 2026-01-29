# QCut Feature Questions & Analysis

This document contains feature proposals and analysis for QCut video editor.

---

## Q1: Should we support folder structure in the media panel?

### Recommendation: **Yes**

### Analysis

**Why folder structure is valuable:**

1. **Professional workflow alignment** - Adobe Premiere, DaVinci Resolve, and Final Cut Pro all support folder/bin organization. Users migrating from these tools expect this capability.

2. **Scalability for large projects** - A documentary or long-form video can have 100+ media files. Without folders, the media panel becomes unmanageable.

3. **Logical grouping** - Users naturally want to organize by:
   - Scene (Scene 1, Scene 2, etc.)
   - Type (B-roll, Interviews, Music, SFX)
   - Status (Raw, Edited, Final)
   - Source (Camera A, Camera B, Stock footage)

4. **Reduced cognitive load** - Finding the right clip in a flat list of 50+ items is slow and frustrating.

### Implementation Considerations

| Aspect | Recommendation |
|--------|----------------|
| Storage | Virtual folders (metadata only, not actual file system) |
| Nesting depth | Limit to 3 levels to prevent over-complexity |
| Drag & drop | Support moving items between folders |
| Default folders | Auto-create: Video, Audio, Images, Generated |
| Search | Search across all folders with option to filter by folder |

### UI/UX Design

```
Media Panel
├── [+] New Folder button
├── 📁 Scene 1
│   ├── interview_john.mp4
│   └── b-roll_office.mp4
├── 📁 Scene 2
│   └── product_demo.mp4
├── 📁 Audio
│   ├── background_music.mp3
│   └── voiceover.wav
└── 📁 AI Generated
    └── avatar_intro.mp4
```

### Priority: **Medium-High**

This is a quality-of-life feature that significantly improves usability for serious projects.

---

## Q2: Should we support copying file path / folder path?

### Recommendation: **Yes**

### Analysis

**Use cases:**

1. **Debugging** - When something goes wrong, developers/users need to locate the actual file
2. **External tool integration** - Open in external editor, terminal commands, FFmpeg operations
3. **File management** - Locate source files on disk for backup or organization
4. **Sharing** - Copy path to share with collaborators or support

### Implementation

**Context menu options:**

| Action | Behavior |
|--------|----------|
| Copy File Path | Copies absolute path: `C:\Users\...\video.mp4` |
| Copy Folder Path | Copies parent directory: `C:\Users\...\media\` |
| Open in File Explorer | Opens containing folder with file selected |
| Copy Relative Path | Copies project-relative path (optional) |

**Keyboard shortcut:** `Ctrl+Shift+C` for quick copy path

### Code Example

```typescript
// Context menu item in media panel
const handleCopyPath = (item: MediaItem) => {
  const path = item.type === 'folder' ? item.path : item.filePath;
  navigator.clipboard.writeText(path);
  toast.success('Path copied to clipboard');
};

const handleOpenInExplorer = (item: MediaItem) => {
  window.electronAPI.shell.showItemInFolder(item.filePath);
};
```

### Priority: **Low-Medium**

Simple to implement, useful for power users, but not critical for basic editing workflow.

---

---

## Q3: Real Folders vs Virtual Folders - Which is Better?

### Recommendation: **Virtual Folders**

### Comparison

| Aspect | Real Folders (File System) | Virtual Folders (Metadata) |
|--------|---------------------------|---------------------------|
| File location | Physically moves files | Files stay in original location |
| Speed | Slow (disk I/O) | Fast (database update) |
| Risk | High - can break references | Low - non-destructive |
| Same file in multiple folders | No | Yes (like tags) |
| Visible outside app | Yes (File Explorer) | No (QCut only) |
| Undo/Redo | Complex | Trivial |
| Cross-platform | Permission issues | Consistent |

### What Professional Editors Do

| Editor | Approach |
|--------|----------|
| Adobe Premiere Pro | Virtual bins (metadata) |
| DaVinci Resolve | Virtual bins (metadata) |
| Final Cut Pro X | Virtual events/keywords |
| Blender VSE | Virtual collections |

**All major editors use virtual folders.** This is the industry standard.

### Why Virtual Folders Win

1. **Non-destructive** - Original files are never touched. Users keep their own folder structure on disk.

2. **Flexible organization** - Same clip can exist in multiple folders:
   ```
   📁 Scene 1
   │   └── interview.mp4
   📁 Best Takes        ← same file!
   │   └── interview.mp4
   📁 Needs Color Grade ← same file!
       └── interview.mp4
   ```

3. **No "where did my file go?"** - Real folder moves can confuse users and break external references.

4. **Fast operations** - Moving 100 files between virtual folders = 100 database updates (milliseconds). Real moves = 100 file copies (seconds/minutes).

5. **Safe** - If virtual folder metadata is lost, original files are still intact. If real folder move fails mid-way, you have a mess.

6. **Project isolation** - Organization in Project A doesn't affect Project B, even if they share source files.

### When Real Folders Make Sense

Real folders might be preferred if:
- User explicitly wants to reorganize source files on disk
- Integration with external tools that read folder structure
- Archival/handoff to another editor

**Solution:** Offer "Consolidate Project" feature that optionally copies files to a real folder structure for export/archive.

### Implementation Recommendation

```typescript
// Virtual folder structure in project state
interface MediaFolder {
  id: string;
  name: string;
  parentId: string | null;  // for nesting
  color?: string;           // visual organization
}

interface MediaItem {
  id: string;
  filePath: string;         // actual location on disk (never changes)
  folderIds: string[];      // can be in multiple folders
  // ...
}
```

### Conclusion

**Virtual folders are the correct choice** because:
- Industry standard (Premiere, Resolve, FCP all do this)
- Non-destructive and safe
- More flexible (multi-folder membership)
- Better UX (fast, undoable)

Real folder manipulation should only happen during explicit "Export Project" or "Consolidate Media" operations.

---

## Q4: Where should QCut store generated files (AI skills, exports, etc.)?

### The Problem

When AI generates a video/image/audio, where does the actual file go?

```
User: "Generate a video of a sunset"
AI: Creates sunset.mp4
QCut: Saves to... where?
```

### Recommended Structure

```
[User Documents]/
└── QCut/
    └── Projects/
        └── MyProject/
            ├── project.qcut           # Project file
            ├── media/                  # Imported media (copied or referenced)
            │   ├── imported/           # User-imported files
            │   └── generated/          # AI-generated content
            │       ├── videos/
            │       ├── images/
            │       ├── audio/
            │       └── avatars/
            ├── exports/                # Rendered outputs
            └── cache/                  # Thumbnails, waveforms, temp files
```

### Why Project-Based Storage?

| Approach | Pros | Cons |
|----------|------|------|
| **Project folder** (recommended) | Portable, self-contained, easy backup | Larger project size |
| Global app data | Saves disk space (shared) | Project not portable, broken links |
| User-specified | Flexible | Confusing, inconsistent |

**Project folder wins because:**
1. **Portable** - Zip the project folder, share with anyone
2. **Self-contained** - No broken links when moving projects
3. **Clear ownership** - Generated files belong to the project
4. **Easy backup** - One folder = entire project

### Implementation

```typescript
// In Electron main process
const getProjectPaths = (projectId: string) => {
  const base = path.join(app.getPath('documents'), 'QCut', 'Projects', projectId);
  return {
    root: base,
    media: path.join(base, 'media'),
    imported: path.join(base, 'media', 'imported'),
    generated: path.join(base, 'media', 'generated'),
    exports: path.join(base, 'exports'),
    cache: path.join(base, 'cache'),
  };
};

// When AI generates a file
const saveGeneratedFile = async (buffer: Buffer, type: 'video' | 'image' | 'audio') => {
  const paths = getProjectPaths(currentProjectId);
  const filename = `${type}_${Date.now()}.${getExtension(type)}`;
  const filepath = path.join(paths.generated, type + 's', filename);
  await fs.writeFile(filepath, buffer);
  return filepath;
};
```

### For video-agent-skill Integration

When QCut calls video-agent-skill:

```typescript
// QCut calls the AI pipeline
const result = await executeCommand(
  `ai-content-pipeline create-video --text "${prompt}" --output "${projectPaths.generated}/videos/"`
);

// File is saved directly to project folder
// Then add to media panel (virtual folder)
addToMediaPanel({
  filePath: result.outputPath,
  folderIds: ['ai-generated'],  // virtual folder
});
```

### Global Cache (Optional)

For expensive AI generations, consider a global cache:

```
[App Data]/
└── QCut/
    └── ai-cache/
        └── [hash-of-prompt]/
            └── video.mp4
```

This way, if user generates the same prompt twice, you can reuse the cached version. But always **copy to project folder** when actually used.

---

## Summary

| Feature | Recommendation | Priority | Effort |
|---------|---------------|----------|--------|
| Folder structure in media panel | Yes | Medium-High | Medium |
| Copy file/folder path | Yes | Low-Medium | Low |
| Virtual vs Real folders | **Virtual** | - | - |

Both features align with professional video editor standards and improve the user experience without adding unnecessary complexity.
