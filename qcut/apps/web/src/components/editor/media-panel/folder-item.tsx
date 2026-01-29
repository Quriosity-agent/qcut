"use client";

import { useState } from "react";
import { useFolderStore } from "@/stores/folder-store";
import type { MediaFolder } from "@/stores/media-store-types";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FolderItemProps {
  folder: MediaFolder;
  depth: number;
  onSelect: (folderId: string | null) => void;
}

// Predefined folder colors
const FOLDER_COLORS = [
  { label: "Default", value: undefined },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
  { label: "Pink", value: "#ec4899" },
];

export function FolderItem({ folder, depth, onSelect }: FolderItemProps) {
  const {
    selectedFolderId,
    getChildFolders,
    toggleFolderExpanded,
    deleteFolder,
    renameFolder,
    setFolderColor,
  } = useFolderStore();

  const children = getChildFolders(folder.id);
  const hasChildren = children.length > 0;
  const isSelected = selectedFolderId === folder.id;
  const isExpanded = folder.isExpanded;

  // Dialog states
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [newName, setNewName] = useState(folder.name);

  const handleRenameSubmit = () => {
    if (newName && newName.trim() && newName.trim() !== folder.name) {
      renameFolder(folder.id, newName.trim());
    }
    setIsRenameOpen(false);
  };

  const handleDeleteConfirm = () => {
    deleteFolder(folder.id);
    setIsDeleteOpen(false);
  };

  const openRenameDialog = () => {
    setNewName(folder.name);
    setIsRenameOpen(true);
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`w-full px-2 py-1.5 text-sm rounded flex items-center gap-1 transition-colors cursor-default ${
              isSelected
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            {/* Expand/Collapse toggle */}
            {hasChildren ? (
              <button
                type="button"
                className="p-0.5 hover:bg-muted/50 rounded flex-shrink-0"
                onClick={() => toggleFolderExpanded(folder.id)}
                aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                aria-expanded={isExpanded}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}

            {/* Folder select button */}
            <button
              type="button"
              className="flex-1 text-left flex items-center gap-1 min-w-0"
              onClick={() => onSelect(folder.id)}
              aria-selected={isSelected}
            >
              {/* Folder icon */}
              {isExpanded && hasChildren ? (
                <FolderOpen
                  className="h-4 w-4 flex-shrink-0"
                  style={{ color: folder.color || undefined }}
                  aria-hidden="true"
                />
              ) : (
                <Folder
                  className="h-4 w-4 flex-shrink-0"
                  style={{ color: folder.color || undefined }}
                  aria-hidden="true"
                />
              )}

              {/* Folder name */}
              <span className="truncate flex-1">{folder.name}</span>
            </button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={openRenameDialog}>Rename</ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger>Change Color</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {FOLDER_COLORS.map((color) => (
                <ContextMenuItem
                  key={color.label}
                  onClick={() => setFolderColor(folder.id, color.value || "")}
                >
                  <span
                    className="w-3 h-3 rounded-full mr-2 border border-border"
                    style={{
                      backgroundColor: color.value || "currentColor",
                      opacity: color.value ? 1 : 0.3,
                    }}
                    aria-hidden="true"
                  />
                  {color.label}
                  {folder.color === color.value && " ✓"}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />

          <ContextMenuItem variant="destructive" onClick={() => setIsDeleteOpen(true)}>
            Delete Folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for this folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name" className="sr-only">
              Folder name
            </Label>
            <Input
              id="folder-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSubmit();
                }
              }}
              placeholder="Folder name"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!newName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Folder
            </DialogTitle>
            <DialogDescription>
              {children.length > 0 ? (
                <>
                  Are you sure you want to delete &quot;{folder.name}&quot; and
                  all {children.length} subfolder(s)?
                </>
              ) : (
                <>Are you sure you want to delete &quot;{folder.name}&quot;?</>
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Media files will NOT be deleted, only the folder organization.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Children (recursive rendering) */}
      {isExpanded && hasChildren && (
        <div role="group" aria-label={`Contents of ${folder.name}`}>
          {children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
