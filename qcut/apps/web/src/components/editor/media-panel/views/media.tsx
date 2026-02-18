"use client";

import { useDragDrop } from "@/hooks/use-drag-drop";
// Media processing utilities will be imported dynamically when needed
import { useAsyncMediaStore } from "@/hooks/use-async-media-store";
import type { MediaItem } from "@/stores/media-store-types";
import {
  Image,
  Loader2,
  Music,
  Plus,
  Video,
  Edit,
  Layers,
  Copy,
  FolderInput,
  ExternalLink,
  RefreshCw,
  Download,
  Trash2,
  X,
  MoreHorizontal,
  ListPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { debugLog, debugError } from "@/lib/debug-config";
import { createObjectURL } from "@/lib/blob-manager";
import { Button } from "@/components/ui/button";
import { MediaDragOverlay } from "@/components/editor/media-panel/drag-overlay";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
  ContextMenuCheckboxItem,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DraggableMediaItem } from "@/components/ui/draggable-item";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAdjustmentStore } from "@/stores/adjustment-store";
import { useText2ImageStore } from "@/stores/text2image-store";
import { useMediaPanelStore } from "../store";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";
import { useFolderStore } from "@/stores/folder-store";
import { cn } from "@/lib/utils";
import { FolderTree } from "../folder-tree";

/** Media library view with drag-and-drop upload, folder filtering, search, and context menu actions. */
export function MediaView() {
  const {
    store: mediaStore,
    loading: mediaStoreLoading,
    error: mediaStoreError,
  } = useAsyncMediaStore();
  // Memoize to prevent infinite loops
  const mediaItems = useMemo(
    () => mediaStore?.mediaItems || [],
    [mediaStore?.mediaItems]
  );
  const addMediaItem = mediaStore?.addMediaItem;
  const removeMediaItem = mediaStore?.removeMediaItem;
  const addToFolder = mediaStore?.addToFolder;
  const removeFromFolder = mediaStore?.removeFromFolder;

  // Folder state
  const { folders, selectedFolderId } = useFolderStore();
  const { activeProject } = useProjectStore();
  const { setOriginalImage } = useAdjustmentStore();
  const { setActiveTab } = useMediaPanelStore();
  const setModelType = useText2ImageStore((s) => s.setModelType);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState("all");
  const [filteredMediaItems, setFilteredMediaItems] = useState<MediaItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const hasSyncedRef = useRef(false);

  // Media store state monitoring (debug removed)
  // useEffect(() => {
  //   // Debug logging removed - media store working correctly
  // }, [mediaItems, activeProject, mediaStore, mediaStoreLoading]);

  useEffect(() => {
    const filtered = mediaItems.filter((item) => {
      // Filter out ephemeral items
      if (item.ephemeral) {
        return false;
      }

      if (mediaFilter && mediaFilter !== "all" && item.type !== mediaFilter) {
        return false;
      }

      if (
        searchQuery &&
        !item.name.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }

      // Filter by selected folder
      if (selectedFolderId !== null) {
        if (!(item.folderIds || []).includes(selectedFolderId)) {
          return false;
        }
      }

      return true;
    });

    setFilteredMediaItems(filtered);
    // Clear selection when filter/folder changes
    setSelectedIds(new Set());
  }, [mediaItems, mediaFilter, searchQuery, selectedFolderId]);

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) {
      return;
    }
    if (!activeProject) {
      toast.error("No active project");
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    try {
      // WORKAROUND: Convert FileList to Array immediately to prevent data loss
      const filesArray = Array.from(files);

      // Dynamically import media processing utilities
      const { processMediaFiles } = await import("@/lib/media-processing");
      const processedItems = await processMediaFiles(filesArray, (p) => {
        setProgress(p);
      });

      // Add processed media items to the store in parallel
      if (!addMediaItem) {
        throw new Error("Media store not ready");
      }
      await Promise.all(
        processedItems.map((item) => addMediaItem(activeProject.id, item))
      );

      toast.success(`Successfully uploaded ${processedItems.length} file(s)`);
    } catch (error) {
      debugError("[Media View] Upload process failed:", error);
      toast.error("Failed to process files");
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const { isDragOver, dragProps } = useDragDrop({
    // When files are dropped, process them
    onDrop: processFiles,
  });

  const handleFileSelect = () => fileInputRef.current?.click(); // Open file picker

  // Sync project folder: scan disk for untracked files and import them
  const handleSync = useCallback(async () => {
    if (!activeProject?.id || isSyncing) return;
    setIsSyncing(true);
    try {
      const { syncProjectFolder } = await import("@/lib/project-folder-sync");
      const result = await syncProjectFolder(activeProject.id);
      if (result.imported > 0) {
        toast.success(`Synced ${result.imported} file(s) from project folder`);
      } else if (result.errors.length > 0) {
        toast.error(`Sync failed for ${result.errors.length} file(s)`);
      } else {
        toast.info("Project folder in sync — no new files found");
      }
    } catch (err) {
      debugError("[MediaView] Sync failed:", err);
      toast.error("Failed to sync project folder");
    } finally {
      setIsSyncing(false);
    }
  }, [activeProject?.id, isSyncing]);

  // Auto-sync on first mount when media store is initialized
  useEffect(() => {
    if (
      !hasSyncedRef.current &&
      mediaStore?.hasInitialized &&
      activeProject?.id &&
      window.electronAPI?.projectFolder
    ) {
      hasSyncedRef.current = true;
      import("@/lib/project-folder-sync")
        .then(({ syncProjectFolder }) => syncProjectFolder(activeProject.id))
        .then((result) => {
          if (result.imported > 0) {
            toast.info(
              `Auto-synced ${result.imported} file(s) from project folder`
            );
          }
        })
        .catch(() => {
          // Silent fail for auto-sync — user can manually trigger via button
        });
    }
  }, [mediaStore?.hasInitialized, activeProject?.id]);

  // Selection helpers
  const toggleSelect = useCallback(
    (id: string, e?: React.MouseEvent) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (e?.shiftKey && prev.size > 0) {
          // Range select
          const lastId = [...prev].pop()!;
          const ids = filteredMediaItems.map((m) => m.id);
          const a = ids.indexOf(lastId);
          const b = ids.indexOf(id);
          const [start, end] = a < b ? [a, b] : [b, a];
          for (let i = start; i <= end; i++) next.add(ids[i]);
        } else if (e?.metaKey || e?.ctrlKey) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          if (next.size === 1 && next.has(id)) {
            next.clear();
          } else {
            next.clear();
            next.add(id);
          }
        }
        return next;
      });
    },
    [filteredMediaItems]
  );

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleAddSelectedToTimeline = useCallback(() => {
    const { addMediaAtTime } = useTimelineStore.getState();
    const { currentTime } = usePlaybackStore.getState();
    const items = mediaItems.filter((m) => selectedIds.has(m.id));
    for (const item of items) {
      addMediaAtTime(item, currentTime);
    }
    toast.success(`Added ${items.length} item(s) to timeline`);
    clearSelection();
  }, [selectedIds, mediaItems, clearSelection]);

  const handleDeleteSelected = useCallback(async () => {
    if (!activeProject || !removeMediaItem) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => removeMediaItem(activeProject.id, id)));
    toast.success(`Deleted ${ids.length} item(s)`);
    clearSelection();
  }, [selectedIds, activeProject, removeMediaItem, clearSelection]);

  const handleDownloadSelected = useCallback(async () => {
    const items = mediaItems.filter((m) => selectedIds.has(m.id));
    for (const item of items) {
      const url = item.url || item.thumbnailUrl;
      if (!url) continue;
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.click();
    }
    toast.success(`Downloading ${items.length} item(s)`);
  }, [selectedIds, mediaItems]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // When files are selected via file picker, process them
    if (e.target.files) processFiles(e.target.files);
    e.target.value = ""; // Reset input
  };

  const handleRemove = async (e: React.MouseEvent, id: string) => {
    // Remove a media item from the store
    e.stopPropagation();

    if (!activeProject) {
      toast.error("No active project");
      return;
    }

    // Media store now handles cascade deletion automatically
    if (removeMediaItem) {
      await removeMediaItem(activeProject.id, id);
    } else {
      toast.error("Media store not loaded");
    }
  };

  const handleEdit = async (e: React.MouseEvent, item: MediaItem) => {
    // Send image to adjustment panel for editing
    e.stopPropagation();

    if (item.type !== "image") {
      toast.error("Only images can be edited");
      return;
    }

    if (!item.file) {
      toast.error("Image file not available for editing");
      return;
    }

    try {
      // Set the original image in the adjustment store
      const imageUrl =
        item.url ||
        item.thumbnailUrl ||
        createObjectURL(item.file, "adjustment-original");
      setOriginalImage(item.file, imageUrl);

      // Switch to AI Images tab with adjustment mode
      setModelType("adjustment");
      setActiveTab("text2image");

      toast.success(`"${item.name}" loaded in AI Images`);
    } catch (error) {
      debugError("Failed to load image for editing:", error);
      toast.error("Failed to load image for editing");
    }
  };

  const formatDuration = (duration: number) => {
    // Format seconds as mm:ss
    const min = Math.floor(duration / 60);
    const sec = Math.floor(duration % 60);
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  // Handle media store loading/error states
  if (mediaStoreError) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <div className="text-red-500 mb-2">Failed to load media store</div>
          <div className="text-sm text-muted-foreground">
            {mediaStoreError.message}
          </div>
        </div>
      </div>
    );
  }

  if (mediaStoreLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading media library...</span>
        </div>
      </div>
    );
  }

  const renderPreview = (item: MediaItem) => {
    // Render a preview for each media type (image, video, audio, unknown)
    if (item.type === "image") {
      const imageUrl = item.url || item.thumbnailUrl;

      return (
        <div className="w-full h-full flex items-center justify-center">
          <img
            src={imageUrl}
            alt={item.name}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
          />
        </div>
      );
    }

    if (item.type === "video") {
      // Show loading spinner while thumbnail is being generated
      if (
        item.thumbnailStatus === "loading" ||
        item.thumbnailStatus === "pending"
      ) {
        return (
          <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
            <Loader2 className="h-6 w-6 mb-1 animate-spin" />
            <span className="text-xs">Loading...</span>
            {item.duration && (
              <span className="text-xs opacity-70">
                {formatDuration(item.duration)}
              </span>
            )}
          </div>
        );
      }

      // Show thumbnail if available
      if (item.thumbnailUrl) {
        return (
          <div className="relative w-full h-full">
            <img
              src={item.thumbnailUrl}
              alt={item.name}
              className="w-full h-full object-cover rounded"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-background/20 rounded">
              <Video className="h-6 w-6 text-foreground drop-shadow-md" />
            </div>
            {item.duration && (
              <div className="absolute bottom-1 right-1 bg-background/70 text-foreground text-xs px-1 rounded">
                {formatDuration(item.duration)}
              </div>
            )}
          </div>
        );
      }

      // Fallback: no thumbnail available
      return (
        <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
          <Video className="h-6 w-6 mb-1" />
          <span className="text-xs">Video</span>
          {item.duration && (
            <span className="text-xs opacity-70">
              {formatDuration(item.duration)}
            </span>
          )}
        </div>
      );
    }

    if (item.type === "audio") {
      return (
        <div className="w-full h-full bg-linear-to-br from-green-500/20 to-emerald-500/20 flex flex-col items-center justify-center text-muted-foreground rounded border border-green-500/20">
          <Music className="h-6 w-6 mb-1" />
          <span className="text-xs">Audio</span>
          {item.duration && (
            <span className="text-xs opacity-70">
              {formatDuration(item.duration)}
            </span>
          )}
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
        <Image className="h-6 w-6" />
        <span className="text-xs mt-1">Unknown</span>
      </div>
    );
  };

  return (
    <div className="flex h-full">
      {/* Folder sidebar */}
      <div className="w-44 min-w-[140px] max-w-[200px] flex-shrink-0">
        <FolderTree />
      </div>

      {/* Main media content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Hidden file input for uploading media */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
          aria-label="Upload media files"
        />

        <div
          className={`h-full flex flex-col gap-1 transition-colors relative ${isDragOver ? "bg-accent/30" : ""}`}
          {...dragProps}
        >
          <div className="p-3 pb-2 bg-panel">
            {selectedIds.size > 0 ? (
              /* Selection toolbar */
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium whitespace-nowrap">
                  {selectedIds.size} selected
                </span>
                {selectedIds.size < filteredMediaItems.length && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:text-primary/80 whitespace-nowrap"
                    onClick={() =>
                      setSelectedIds(
                        new Set(filteredMediaItems.map((m) => m.id))
                      )
                    }
                  >
                    Select All
                  </button>
                )}
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleAddSelectedToTimeline}
                >
                  <ListPlus className="h-3.5 w-3.5 mr-1" />
                  Add to Timeline
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleDownloadSelected}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-destructive hover:text-destructive"
                  onClick={handleDeleteSelected}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="text"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={clearSelection}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Deselect
                </Button>
              </div>
            ) : (
              /* Default toolbar */
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFileSelect}
                  disabled={isProcessing}
                  className="h-8 text-xs"
                  data-testid="import-media-button"
                  aria-label={isProcessing ? "Importing media" : "Import media"}
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 mr-1" />
                  )}
                  Import
                </Button>
                <Input
                  type="text"
                  placeholder="Search media..."
                  className="min-w-[60px] flex-1 h-8 text-xs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Select value={mediaFilter} onValueChange={setMediaFilter}>
                  <SelectTrigger className="w-[80px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="audio">Audio</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="text"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleSync}
                      disabled={isSyncing || isProcessing}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`}
                      />
                      Sync Project Folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <ScrollArea className="h-full">
            <div className="flex-1 p-3 pt-0">
              {isDragOver || filteredMediaItems.length === 0 ? (
                <MediaDragOverlay
                  isVisible={true}
                  isProcessing={isProcessing}
                  progress={progress}
                  onClick={handleFileSelect}
                  isEmptyState={filteredMediaItems.length === 0 && !isDragOver}
                />
              ) : (
                <div
                  className="grid gap-2"
                  style={{
                    gridTemplateColumns: "repeat(auto-fill, 160px)",
                  }}
                >
                  {/* Render each media item as a draggable, selectable button */}
                  {filteredMediaItems.map((item) => (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger>
                        <div
                          onClickCapture={(e) => {
                            toggleSelect(item.id, e);
                          }}
                          className={cn(
                            "rounded-sm transition-shadow",
                            selectedIds.has(item.id) &&
                              "ring-2 ring-primary ring-offset-1 ring-offset-background"
                          )}
                        >
                          <DraggableMediaItem
                            name={item.name}
                            preview={renderPreview(item)}
                            dragData={{
                              id: item.id,
                              type: item.type,
                              name: item.name,
                            }}
                            showPlusOnDrag={false}
                            onAddToTimeline={(currentTime) =>
                              useTimelineStore
                                .getState()
                                .addMediaAtTime(item, currentTime)
                            }
                            rounded={false}
                            data-testid="media-item"
                          />
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem>Export clips</ContextMenuItem>
                        {(item.type === "image" || item.type === "video") && (
                          <ContextMenuItem
                            aria-label="Add as overlay"
                            onClick={(e) => {
                              e.stopPropagation();

                              // Debug logging for overlay creation (Task 2.2)
                              // Note: We use filteredMediaItems which is already available from the hook
                              const mediaExists = filteredMediaItems.some(
                                (m) => m.id === item.id
                              );

                              debugLog("[MediaPanel] Overlay creation check:", {
                                targetItemId: item.id,
                                targetItemName: item.name,
                                mediaExists,
                                totalMediaItems: filteredMediaItems.length,
                                availableMediaIds: filteredMediaItems.map(
                                  (m) => m.id
                                ),
                                timestamp: new Date().toISOString(),
                              });

                              const { addOverlaySticker } =
                                useStickersOverlayStore.getState();
                              const { currentTime } =
                                usePlaybackStore.getState();
                              const { getTotalDuration } =
                                useTimelineStore.getState();
                              const totalDuration = getTotalDuration();

                              if (totalDuration <= 0) {
                                toast.error("Add media to timeline first");
                                return;
                              }

                              const start = Math.max(
                                0,
                                Math.min(currentTime, totalDuration - 0.1)
                              );
                              const end = Math.min(start + 5, totalDuration);

                              const overlayData = {
                                timing: {
                                  startTime: start,
                                  endTime: end,
                                },
                              };

                              addOverlaySticker(item.id, overlayData);

                              toast.success(`Added "${item.name}" as overlay`);
                            }}
                          >
                            <Layers
                              className="h-4 w-4 mr-2"
                              aria-hidden="true"
                            />
                            Add as Overlay
                          </ContextMenuItem>
                        )}
                        {item.type === "image" && (
                          <ContextMenuItem onClick={(e) => handleEdit(e, item)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Image edit
                          </ContextMenuItem>
                        )}

                        {/* Add to Folders (multi-folder support) */}
                        <ContextMenuSub>
                          <ContextMenuSubTrigger>
                            <FolderInput
                              className="h-4 w-4 mr-2"
                              aria-hidden="true"
                            />
                            Add to Folders
                          </ContextMenuSubTrigger>
                          <ContextMenuSubContent>
                            {folders.length === 0 && (
                              <ContextMenuItem disabled>
                                No folders created
                              </ContextMenuItem>
                            )}
                            {folders.map((folder) => {
                              const isInFolder = (
                                item.folderIds || []
                              ).includes(folder.id);
                              return (
                                <ContextMenuCheckboxItem
                                  key={folder.id}
                                  checked={isInFolder}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      addToFolder?.(item.id, folder.id);
                                    } else {
                                      removeFromFolder?.(item.id, folder.id);
                                    }
                                  }}
                                >
                                  {folder.name}
                                </ContextMenuCheckboxItem>
                              );
                            })}
                          </ContextMenuSubContent>
                        </ContextMenuSub>

                        {/* Copy File Path */}
                        <ContextMenuItem
                          onClick={async (e) => {
                            e.stopPropagation();
                            const path = item.localPath || item.url;
                            if (path && !path.startsWith("blob:")) {
                              try {
                                await navigator.clipboard.writeText(path);
                                toast.success("Path copied to clipboard");
                              } catch (error) {
                                debugError(
                                  "[Media View] Clipboard copy failed:",
                                  error
                                );
                                toast.error("Failed to copy path");
                              }
                            } else {
                              toast.error("No file path available");
                            }
                          }}
                        >
                          <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
                          Copy File Path
                        </ContextMenuItem>

                        {/* Open in Explorer (Electron only) */}
                        {item.localPath && (
                          <ContextMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.electronAPI?.shell?.showItemInFolder) {
                                try {
                                  window.electronAPI.shell.showItemInFolder(
                                    item.localPath!
                                  );
                                } catch (error) {
                                  debugError(
                                    "[Media View] Open in Explorer failed:",
                                    error
                                  );
                                  toast.error("Failed to open in Explorer");
                                }
                              } else {
                                toast.error("Only available in desktop app");
                              }
                            }}
                          >
                            <ExternalLink
                              className="h-4 w-4 mr-2"
                              aria-hidden="true"
                            />
                            Open in Explorer
                          </ContextMenuItem>
                        )}

                        <ContextMenuSeparator />

                        <ContextMenuItem
                          variant="destructive"
                          onClick={(e) => handleRemove(e, item.id)}
                        >
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
