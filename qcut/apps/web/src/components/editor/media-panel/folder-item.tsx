"use client";

import { useFolderStore } from "@/stores/folder-store";
import type { MediaFolder } from "@/stores/media-store-types";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
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

  const handleRename = () => {
    const newName = prompt("Rename folder:", folder.name);
    if (newName && newName.trim()) {
      renameFolder(folder.id, newName.trim());
    }
  };

  const handleDelete = () => {
    const hasDescendants = children.length > 0;
    const message = hasDescendants
      ? `Delete folder "${folder.name}" and all ${children.length} subfolder(s)?\n\nMedia files will NOT be deleted.`
      : `Delete folder "${folder.name}"?\n\nMedia files will NOT be deleted.`;

    if (confirm(message)) {
      deleteFolder(folder.id);
    }
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            type="button"
            className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-1 transition-colors ${
              isSelected
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => onSelect(folder.id)}
            aria-selected={isSelected}
          >
            {/* Expand/Collapse toggle */}
            {hasChildren ? (
              <button
                type="button"
                className="p-0.5 hover:bg-muted/50 rounded flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolderExpanded(folder.id);
                }}
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
              <span className="w-4 flex-shrink-0" /> // Spacer for alignment
            )}

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
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={handleRename}>Rename</ContextMenuItem>

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

          <ContextMenuItem variant="destructive" onClick={handleDelete}>
            Delete Folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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
