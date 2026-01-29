"use client";

import { useFolderStore } from "@/stores/folder-store";
import { useSkillsStore } from "@/stores/skills-store";
import { SKILLS_FOLDER_ID } from "@/stores/media-store-types";
import { FolderItem } from "./folder-item";
import { CreateFolderDialog } from "./create-folder-dialog";
import { Button } from "@/components/ui/button";
import { FolderPlus, Brain } from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FolderTreeProps {
  onFolderSelect?: (folderId: string | null) => void;
}

export function FolderTree({ onFolderSelect }: FolderTreeProps) {
  const { selectedFolderId, setSelectedFolder, getChildFolders } =
    useFolderStore();
  const { skills } = useSkillsStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const rootFolders = getChildFolders(null);

  const handleSelect = (folderId: string | null) => {
    setSelectedFolder(folderId);
    onFolderSelect?.(folderId);
  };

  return (
    <div className="flex flex-col h-full border-r border-border bg-panel-accent/30">
      {/* Header */}
      <div className="p-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Folders
        </span>
        <Button
          type="button"
          variant="text"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setIsCreateDialogOpen(true)}
          aria-label="Create new folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Folder List */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {/* All Media (root view) */}
          <button
            type="button"
            className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2 transition-colors ${
              selectedFolderId === null
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
            onClick={() => handleSelect(null)}
          >
            <span>All Media</span>
          </button>

          {/* Folder hierarchy */}
          {rootFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              depth={0}
              onSelect={handleSelect}
            />
          ))}

          {/* Empty state */}
          {rootFolders.length === 0 && (
            <div className="px-2 py-4 text-xs text-muted-foreground text-center">
              No folders yet.
              <br />
              Click + to create one.
            </div>
          )}

          {/* Skills System Folder - Always at bottom */}
          <div className="mt-2 pt-2 border-t border-border">
            <button
              type="button"
              className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2 transition-colors ${
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

      <CreateFolderDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
}
