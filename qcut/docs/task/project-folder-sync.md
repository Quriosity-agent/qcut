# Project Folder Sync to Media Panel

## Overview

Sync project folder contents (media/imported, media/generated, etc.) to the Media Panel, enabling users to browse, import, and manage files from their project directory structure.

## Architecture Summary

### Current State
- **Media Panel**: Grid-based UI with virtual folder navigation (`apps/web/src/components/editor/media-panel/`)
- **Virtual Folders**: Metadata-only folders stored in IndexedDB (`apps/web/src/stores/folder-store.ts`)
- **Media Import**: Single-file import via file picker with symlink/copy support (`electron/media-import-handler.ts`)
- **Missing**: Directory scanning, bulk import, project folder browsing

### Target State
- Browse project folder tree structure in Media Panel
- Bulk import files from project directories
- Map disk folders to virtual folders
- Optional: Watch mode for real-time sync

## Implementation Plan

**Estimated Total Time**: 3-4 hours
**Subtask Count**: 5

---

## Subtask 1: Add Directory Scanning IPC Handler

**Time Estimate**: 45 minutes
**Priority**: High (foundational)

### Description
Create Electron IPC handlers to scan project directories and return file listings.

### Relevant Files
- `electron/project-folder-handler.ts` (NEW)
- `electron/main.ts` (register handlers)
- `electron/preload.ts` (expose API)
- `apps/web/src/types/electron.d.ts` (type definitions)

### Implementation

#### 1.1 Create `electron/project-folder-handler.ts`
```typescript
import { ipcMain, app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

// Supported media extensions
const MEDIA_EXTENSIONS = {
  video: [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"],
  audio: [".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"],
  image: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"],
};

interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  type: "video" | "audio" | "image" | "unknown";
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
}

interface ScanResult {
  files: FileInfo[];
  folders: string[];
  totalSize: number;
  scanTime: number;
}

function getMediaType(ext: string): FileInfo["type"] {
  const lower = ext.toLowerCase();
  if (MEDIA_EXTENSIONS.video.includes(lower)) return "video";
  if (MEDIA_EXTENSIONS.audio.includes(lower)) return "audio";
  if (MEDIA_EXTENSIONS.image.includes(lower)) return "image";
  return "unknown";
}

export function registerProjectFolderHandlers(): void {
  // Get project root path
  ipcMain.handle("project-folder:get-root", async (_, projectId: string): Promise<string> => {
    const documentsPath = app.getPath("documents");
    return path.join(documentsPath, "QCut", "Projects", projectId);
  });

  // Scan directory for media files
  ipcMain.handle("project-folder:scan", async (
    _,
    projectId: string,
    subPath: string = "",
    options: { recursive?: boolean; mediaOnly?: boolean } = {}
  ): Promise<ScanResult> => {
    const startTime = Date.now();
    const documentsPath = app.getPath("documents");
    const projectRoot = path.join(documentsPath, "QCut", "Projects", projectId);
    const targetPath = path.join(projectRoot, subPath);

    const files: FileInfo[] = [];
    const folders: string[] = [];
    let totalSize = 0;

    async function scanDir(dirPath: string, relativeBase: string): Promise<void> {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.join(relativeBase, entry.name);

          if (entry.isDirectory()) {
            folders.push(relativePath);
            if (options.recursive) {
              await scanDir(fullPath, relativePath);
            }
          } else {
            const ext = path.extname(entry.name);
            const mediaType = getMediaType(ext);

            // Skip non-media files if mediaOnly is set
            if (options.mediaOnly && mediaType === "unknown") {
              continue;
            }

            const stats = await fs.stat(fullPath);
            totalSize += stats.size;

            files.push({
              name: entry.name,
              path: fullPath,
              relativePath,
              type: mediaType,
              size: stats.size,
              modifiedAt: stats.mtimeMs,
              isDirectory: false,
            });
          }
        }
      } catch (error) {
        console.error(`[project-folder:scan] Error scanning ${dirPath}:`, error);
      }
    }

    await scanDir(targetPath, subPath);

    return {
      files,
      folders,
      totalSize,
      scanTime: Date.now() - startTime,
    };
  });

  // List immediate children of a directory (non-recursive)
  ipcMain.handle("project-folder:list", async (
    _,
    projectId: string,
    subPath: string = ""
  ): Promise<FileInfo[]> => {
    const documentsPath = app.getPath("documents");
    const projectRoot = path.join(documentsPath, "QCut", "Projects", projectId);
    const targetPath = path.join(projectRoot, subPath);

    const entries: FileInfo[] = [];

    try {
      const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });

      for (const entry of dirEntries) {
        const fullPath = path.join(targetPath, entry.name);
        const stats = await fs.stat(fullPath);
        const ext = path.extname(entry.name);

        entries.push({
          name: entry.name,
          path: fullPath,
          relativePath: path.join(subPath, entry.name),
          type: entry.isDirectory() ? "unknown" : getMediaType(ext),
          size: stats.size,
          modifiedAt: stats.mtimeMs,
          isDirectory: entry.isDirectory(),
        });
      }
    } catch (error) {
      console.error(`[project-folder:list] Error listing ${targetPath}:`, error);
    }

    return entries;
  });

  // Check if project folder exists and create if needed
  ipcMain.handle("project-folder:ensure-structure", async (
    _,
    projectId: string
  ): Promise<{ created: string[]; existing: string[] }> => {
    const documentsPath = app.getPath("documents");
    const projectRoot = path.join(documentsPath, "QCut", "Projects", projectId);

    const requiredFolders = [
      "media",
      "media/imported",
      "media/generated",
      "media/generated/images",
      "media/generated/videos",
      "media/generated/audio",
      "media/temp",
      "output",
      "cache",
    ];

    const created: string[] = [];
    const existing: string[] = [];

    for (const folder of requiredFolders) {
      const folderPath = path.join(projectRoot, folder);
      try {
        await fs.access(folderPath);
        existing.push(folder);
      } catch {
        await fs.mkdir(folderPath, { recursive: true });
        created.push(folder);
      }
    }

    return { created, existing };
  });
}
```

#### 1.2 Register in `electron/main.ts`
```typescript
import { registerProjectFolderHandlers } from "./project-folder-handler.js";

// In createWindow() or app.whenReady():
registerProjectFolderHandlers();
```

#### 1.3 Expose in `electron/preload.ts`
```typescript
projectFolder: {
  getRoot: (projectId: string) => ipcRenderer.invoke("project-folder:get-root", projectId),
  scan: (projectId: string, subPath?: string, options?: { recursive?: boolean; mediaOnly?: boolean }) =>
    ipcRenderer.invoke("project-folder:scan", projectId, subPath, options),
  list: (projectId: string, subPath?: string) =>
    ipcRenderer.invoke("project-folder:list", projectId, subPath),
  ensureStructure: (projectId: string) =>
    ipcRenderer.invoke("project-folder:ensure-structure", projectId),
},
```

#### 1.4 Add types in `apps/web/src/types/electron.d.ts`
```typescript
interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  type: "video" | "audio" | "image" | "unknown";
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
}

interface ScanResult {
  files: FileInfo[];
  folders: string[];
  totalSize: number;
  scanTime: number;
}

interface ProjectFolderAPI {
  getRoot: (projectId: string) => Promise<string>;
  scan: (projectId: string, subPath?: string, options?: { recursive?: boolean; mediaOnly?: boolean }) => Promise<ScanResult>;
  list: (projectId: string, subPath?: string) => Promise<FileInfo[]>;
  ensureStructure: (projectId: string) => Promise<{ created: string[]; existing: string[] }>;
}

// Add to ElectronAPI interface:
projectFolder: ProjectFolderAPI;
```

### Tests
- `apps/web/src/stores/__tests__/project-folder-scan.test.ts` (NEW)
  - Test file type detection for various extensions
  - Test recursive vs non-recursive scanning
  - Test mediaOnly filter

---

## Subtask 2: Create Project Folder Browser Component

**Time Estimate**: 60 minutes
**Priority**: High

### Description
Create a UI component to browse and select files from the project folder structure.

### Relevant Files
- `apps/web/src/components/editor/media-panel/views/project-folder.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/project-folder-tree.tsx` (NEW)
- `apps/web/src/hooks/use-project-folder.ts` (NEW)
- `apps/web/src/components/editor/media-panel/index.tsx` (add tab)

### Implementation

#### 2.1 Create `apps/web/src/hooks/use-project-folder.ts`
```typescript
import { useState, useCallback, useEffect } from "react";
import { useProjectStore } from "@/stores/project-store";

interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  type: "video" | "audio" | "image" | "unknown";
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
}

interface ScanResult {
  files: FileInfo[];
  folders: string[];
  totalSize: number;
  scanTime: number;
}

export function useProjectFolder() {
  const { activeProject } = useProjectStore();
  const [isScanning, setIsScanning] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileInfo[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectId = activeProject?.id;

  // List directory contents (non-recursive)
  const listDirectory = useCallback(async (subPath: string = "") => {
    if (!projectId || !window.electronAPI?.projectFolder) return;

    setIsScanning(true);
    setError(null);

    try {
      const result = await window.electronAPI.projectFolder.list(projectId, subPath);
      setEntries(result);
      setCurrentPath(subPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list directory");
    } finally {
      setIsScanning(false);
    }
  }, [projectId]);

  // Scan for all media files (recursive)
  const scanForMedia = useCallback(async (subPath: string = "media") => {
    if (!projectId || !window.electronAPI?.projectFolder) return;

    setIsScanning(true);
    setError(null);

    try {
      const result = await window.electronAPI.projectFolder.scan(projectId, subPath, {
        recursive: true,
        mediaOnly: true,
      });
      setScanResult(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan directory");
      return null;
    } finally {
      setIsScanning(false);
    }
  }, [projectId]);

  // Ensure project folder structure exists
  const ensureStructure = useCallback(async () => {
    if (!projectId || !window.electronAPI?.projectFolder) return;

    try {
      await window.electronAPI.projectFolder.ensureStructure(projectId);
    } catch (err) {
      console.error("[useProjectFolder] Failed to ensure structure:", err);
    }
  }, [projectId]);

  // Navigate to subdirectory
  const navigateTo = useCallback((subPath: string) => {
    listDirectory(subPath);
  }, [listDirectory]);

  // Navigate up one level
  const navigateUp = useCallback(() => {
    if (!currentPath) return;
    const parentPath = currentPath.split(/[/\\]/).slice(0, -1).join("/");
    listDirectory(parentPath);
  }, [currentPath, listDirectory]);

  // Initialize on project change
  useEffect(() => {
    if (projectId) {
      ensureStructure();
      listDirectory("media");
    }
  }, [projectId, ensureStructure, listDirectory]);

  return {
    projectId,
    currentPath,
    entries,
    scanResult,
    isScanning,
    error,
    listDirectory,
    scanForMedia,
    navigateTo,
    navigateUp,
    ensureStructure,
  };
}
```

#### 2.2 Create `apps/web/src/components/editor/media-panel/views/project-folder.tsx`
```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder,
  FolderOpen,
  File,
  Video,
  Image,
  Music,
  RefreshCw,
  ChevronUp,
  Download,
  CheckSquare,
  Square,
} from "lucide-react";
import { useProjectFolder } from "@/hooks/use-project-folder";
import { useMediaStore } from "@/stores/media-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ProjectFolderView() {
  const {
    currentPath,
    entries,
    scanResult,
    isScanning,
    error,
    navigateTo,
    navigateUp,
    scanForMedia,
    listDirectory,
  } = useProjectFolder();

  const { addMediaItem } = useMediaStore();
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);

  // Toggle file selection
  const toggleSelection = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Select all media files
  const selectAll = () => {
    const mediaFiles = entries.filter(
      (e) => !e.isDirectory && e.type !== "unknown"
    );
    setSelectedFiles(new Set(mediaFiles.map((f) => f.path)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedFiles(new Set());
  };

  // Import selected files
  const importSelected = async () => {
    if (selectedFiles.size === 0) return;

    setIsImporting(true);
    let imported = 0;
    let failed = 0;

    for (const filePath of selectedFiles) {
      try {
        // Use existing media import handler
        // This will be implemented to work with the media-store
        // For now, show placeholder
        imported++;
      } catch (err) {
        failed++;
        console.error(`Failed to import ${filePath}:`, err);
      }
    }

    setIsImporting(false);
    setSelectedFiles(new Set());

    if (imported > 0) {
      toast.success(`Imported ${imported} file${imported > 1 ? "s" : ""}`);
    }
    if (failed > 0) {
      toast.error(`Failed to import ${failed} file${failed > 1 ? "s" : ""}`);
    }
  };

  // Get icon for file type
  const getFileIcon = (entry: typeof entries[0]) => {
    if (entry.isDirectory) {
      return <Folder className="h-4 w-4 text-yellow-500" />;
    }
    switch (entry.type) {
      case "video":
        return <Video className="h-4 w-4 text-blue-500" />;
      case "audio":
        return <Music className="h-4 w-4 text-green-500" />;
      case "image":
        return <Image className="h-4 w-4 text-orange-500" />;
      default:
        return <File className="h-4 w-4 text-gray-500" />;
    }
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const mediaFileCount = entries.filter(
    (e) => !e.isDirectory && e.type !== "unknown"
  ).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={navigateUp}
            disabled={!currentPath}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground truncate max-w-[200px]">
            {currentPath || "Project Root"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => listDirectory(currentPath)}
          disabled={isScanning}
        >
          <RefreshCw className={cn("h-4 w-4", isScanning && "animate-spin")} />
        </Button>
      </div>

      {/* Selection toolbar */}
      {mediaFileCount > 0 && (
        <div className="flex items-center justify-between p-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAll}>
              <CheckSquare className="h-4 w-4 mr-1" />
              Select All
            </Button>
            {selectedFiles.size > 0 && (
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <Square className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
          {selectedFiles.size > 0 && (
            <Button
              size="sm"
              onClick={importSelected}
              disabled={isImporting}
            >
              <Download className="h-4 w-4 mr-1" />
              Import {selectedFiles.size}
            </Button>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 text-center text-destructive">
          <p>{error}</p>
        </div>
      )}

      {/* File list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {entries.length === 0 && !isScanning && (
            <div className="p-4 text-center text-muted-foreground">
              No files found
            </div>
          )}

          {entries.map((entry) => (
            <div
              key={entry.path}
              className={cn(
                "flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 cursor-pointer",
                selectedFiles.has(entry.path) && "bg-accent"
              )}
              onClick={() => {
                if (entry.isDirectory) {
                  navigateTo(entry.relativePath);
                } else if (entry.type !== "unknown") {
                  toggleSelection(entry.path);
                }
              }}
            >
              {!entry.isDirectory && entry.type !== "unknown" && (
                <Checkbox
                  checked={selectedFiles.has(entry.path)}
                  onCheckedChange={() => toggleSelection(entry.path)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {getFileIcon(entry)}
              <span className="flex-1 truncate text-sm">{entry.name}</span>
              {!entry.isDirectory && (
                <span className="text-xs text-muted-foreground">
                  {formatSize(entry.size)}
                </span>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Scan summary */}
      {scanResult && (
        <div className="p-2 border-t text-xs text-muted-foreground">
          Found {scanResult.files.length} media files ({formatSize(scanResult.totalSize)})
          in {scanResult.scanTime}ms
        </div>
      )}
    </div>
  );
}
```

### Tests
- `apps/web/src/hooks/__tests__/use-project-folder.test.ts` (NEW)
  - Test navigation state management
  - Test selection toggle logic
  - Test file filtering

---

## Subtask 3: Implement Bulk Import Logic

**Time Estimate**: 45 minutes
**Priority**: High

### Description
Add bulk import functionality to import multiple files from project folder into media store with progress tracking.

### Relevant Files
- `apps/web/src/lib/bulk-import.ts` (NEW)
- `apps/web/src/stores/media-store.ts` (add bulkImportFromPaths method)
- `apps/web/src/components/editor/media-panel/views/project-folder.tsx` (integrate)

### Implementation

#### 3.1 Create `apps/web/src/lib/bulk-import.ts`
```typescript
import { useMediaStore } from "@/stores/media-store";
import { DEFAULT_FOLDER_IDS } from "@/stores/media-store-types";
import { v4 as uuidv4 } from "uuid";

interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  type: "video" | "audio" | "image" | "unknown";
  size: number;
  modifiedAt: number;
}

interface ImportProgress {
  total: number;
  completed: number;
  current: string;
  errors: string[];
}

interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

type ProgressCallback = (progress: ImportProgress) => void;

/**
 * Bulk import files from project folder into media store.
 * Uses symlink/copy via Electron IPC for actual file handling.
 */
export async function bulkImportFiles(
  projectId: string,
  files: FileInfo[],
  options: {
    autoOrganize?: boolean; // Assign to default folders by type
    targetFolderId?: string; // Specific target folder
    onProgress?: ProgressCallback;
  } = {}
): Promise<ImportResult> {
  const { addMediaItem } = useMediaStore.getState();
  const errors: string[] = [];
  let imported = 0;

  const progress: ImportProgress = {
    total: files.length,
    completed: 0,
    current: "",
    errors: [],
  };

  for (const file of files) {
    progress.current = file.name;
    options.onProgress?.(progress);

    try {
      // Generate unique ID for media item
      const mediaId = uuidv4();

      // Import file via Electron IPC (symlink/copy)
      const importResult = await window.electronAPI?.mediaImport?.import({
        sourcePath: file.path,
        projectId,
        mediaId,
        preferSymlink: true,
      });

      if (!importResult?.success) {
        throw new Error(importResult?.error || "Import failed");
      }

      // Create File object from path via Electron IPC (file:// protocol blocked in renderer)
      const fileBuffer = await window.electronAPI?.fs?.readFile(importResult.targetPath);
      if (!fileBuffer) {
        throw new Error("Failed to read imported file");
      }
      const mimeType = getMimeType(file.name, file.type);
      const blob = new Blob([fileBuffer], { type: mimeType });
      const fileObj = new File([blob], file.name, {
        type: mimeType,
      });

      // Determine target folder
      let folderIds: string[] = [];
      if (options.targetFolderId) {
        folderIds = [options.targetFolderId];
      } else if (options.autoOrganize) {
        // Assign to default folder based on type
        switch (file.type) {
          case "video":
            folderIds = [DEFAULT_FOLDER_IDS.VIDEOS];
            break;
          case "audio":
            folderIds = [DEFAULT_FOLDER_IDS.AUDIO];
            break;
          case "image":
            folderIds = [DEFAULT_FOLDER_IDS.IMAGES];
            break;
        }

        // Also add to AI Generated if from generated folder
        if (file.relativePath.startsWith("media/generated")) {
          folderIds.push(DEFAULT_FOLDER_IDS.AI_GENERATED);
        }
      }

      // Add to media store
      await addMediaItem(projectId, {
        id: mediaId,
        name: file.name,
        type: file.type === "unknown" ? "video" : file.type,
        file: fileObj,
        localPath: importResult.targetPath,
        isLocalFile: true,
        folderIds,
        importMetadata: {
          importMethod: importResult.importMethod,
          originalPath: importResult.originalPath,
          importedAt: Date.now(),
          fileSize: importResult.fileSize,
        },
      });

      imported++;
    } catch (err) {
      const errorMsg = `${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`;
      errors.push(errorMsg);
      progress.errors.push(errorMsg);
    }

    progress.completed++;
    options.onProgress?.(progress);
  }

  return { imported, failed: errors.length, errors };
}

function getMimeType(filename: string, type: FileInfo["type"]): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Extension-based MIME type mapping
  const mimeTypes: Record<string, string> = {
    // Video
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    flac: "audio/flac",
    // Image
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };

  if (mimeTypes[ext]) {
    return mimeTypes[ext];
  }

  // Fallback to category-based defaults
  switch (type) {
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/mpeg";
    case "image":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
```

#### 3.2 Update `apps/web/src/stores/media-store.ts`
Add convenience method for bulk import:
```typescript
// Add to MediaStore interface in media-store-types.ts:
bulkImportFromPaths: (
  projectId: string,
  filePaths: string[],
  options?: { autoOrganize?: boolean; targetFolderId?: string }
) => Promise<{ imported: number; failed: number }>;
```

### Tests
- `apps/web/src/lib/__tests__/bulk-import.test.ts` (NEW)
  - Test folder assignment by type
  - Test AI Generated folder detection
  - Test error handling for failed imports
  - Test progress callback invocation

---

## Subtask 4: Add Project Folder Tab to Media Panel

**Time Estimate**: 30 minutes
**Priority**: Medium

### Description
Integrate the Project Folder view as a new tab in the Media Panel navigation.

### Relevant Files
- `apps/web/src/components/editor/media-panel/index.tsx` (add tab)
- `apps/web/src/components/editor/media-panel/views/project-folder.tsx` (integrate)

### Implementation

#### 4.1 Update Media Panel tabs
Add to the existing tabs in `index.tsx`:
```typescript
import { ProjectFolderView } from "./views/project-folder";

// Add to tabs array:
{
  id: "project-folder",
  label: "Project",
  icon: FolderSync, // or appropriate icon
  component: ProjectFolderView,
}
```

#### 4.2 Add FolderSync icon import
```typescript
import { FolderSync } from "lucide-react";
```

### Tests
- Manual testing of tab navigation and component rendering

---

## Subtask 5: Unit Tests and Documentation

**Time Estimate**: 30 minutes
**Priority**: Medium

### Description
Add comprehensive unit tests and update documentation.

### Test Files to Create

#### 5.1 `apps/web/src/stores/__tests__/project-folder-sync.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Project Folder Sync", () => {
  describe("File Type Detection", () => {
    it("should detect video files correctly", () => {
      // Test .mp4, .mov, .webm, .avi, .mkv
    });

    it("should detect audio files correctly", () => {
      // Test .mp3, .wav, .aac, .m4a, .flac
    });

    it("should detect image files correctly", () => {
      // Test .jpg, .png, .webp, .gif, .bmp
    });

    it("should return unknown for non-media files", () => {
      // Test .txt, .pdf, .json, etc.
    });
  });

  describe("Folder Mapping", () => {
    it("should map video files to Videos folder", () => {});
    it("should map audio files to Audio folder", () => {});
    it("should map image files to Images folder", () => {});
    it("should map generated files to AI Generated folder", () => {});
  });

  describe("Bulk Import", () => {
    it("should import multiple files with progress tracking", () => {});
    it("should handle import failures gracefully", () => {});
    it("should skip already-imported files", () => {});
  });
});
```

#### 5.2 `apps/web/src/hooks/__tests__/use-project-folder.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectFolder } from "../use-project-folder";

// Mock electronAPI
vi.mock("@/stores/project-store", () => ({
  useProjectStore: () => ({
    activeProject: { id: "test-project-123" },
  }),
}));

describe("useProjectFolder", () => {
  it("should initialize with media directory", async () => {});
  it("should navigate to subdirectories", async () => {});
  it("should navigate up to parent directory", async () => {});
  it("should scan for media files recursively", async () => {});
  it("should handle scan errors gracefully", async () => {});
});
```

### Documentation Updates

#### 5.3 Update `CLAUDE.md` or create `docs/features/project-folder-sync.md`
- Document the new IPC handlers
- Document the UI workflow
- Document folder mapping behavior

---

## Summary

| Subtask | Time | Priority | Files Modified |
|---------|------|----------|----------------|
| 1. Directory Scanning IPC | 45m | High | 4 new/modified |
| 2. Project Folder Browser | 60m | High | 4 new |
| 3. Bulk Import Logic | 45m | High | 3 new/modified |
| 4. Media Panel Integration | 30m | Medium | 2 modified |
| 5. Tests & Documentation | 30m | Medium | 3 new |

**Total Estimated Time**: 3.5 hours

## Dependencies

- Electron IPC infrastructure (exists)
- Media Import Handler (exists)
- Media Store (exists)
- Folder Store (exists)
- Virtual Folder System (exists)

## Future Enhancements (Out of Scope)

1. **Watch Mode**: Real-time sync using `fs.watch()`
2. **Sync Preferences**: User-configurable sync behavior
3. **Conflict Resolution**: Handle renamed/moved files
4. **Batch Thumbnail Generation**: Pre-generate thumbnails during scan
