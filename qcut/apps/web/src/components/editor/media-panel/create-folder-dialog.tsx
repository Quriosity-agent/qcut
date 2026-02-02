"use client";

import { useState, useEffect } from "react";
import { useFolderStore } from "@/stores/folder-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FOLDER_NAME_MAX_LENGTH } from "@/stores/media-store-types";

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId = null,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const { createFolder, getFolderById } = useFolderStore();

  // Reset name when dialog opens
  useEffect(() => {
    if (open) {
      setName("");
    }
  }, [open]);

  const parentFolder = parentId ? getFolderById(parentId) : null;

  const handleCreate = () => {
    const trimmed = name.trim();

    if (!trimmed) {
      toast.error("Folder name cannot be empty");
      return;
    }

    if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
      toast.error(
        `Folder name must be ${FOLDER_NAME_MAX_LENGTH} characters or less`
      );
      return;
    }

    const folderId = createFolder(trimmed, parentId);

    if (folderId) {
      toast.success(`Created folder "${trimmed}"`);
      setName("");
      onOpenChange(false);
    } else {
      toast.error(
        "Failed to create folder. Maximum nesting depth is 3 levels."
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
          <DialogDescription>
            {parentFolder
              ? `Create a subfolder inside "${parentFolder.name}"`
              : "Create a new folder to organize your media"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Folder"
              maxLength={FOLDER_NAME_MAX_LENGTH}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {name.length}/{FOLDER_NAME_MAX_LENGTH} characters
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
