"use client";

import { useState } from "react";
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
import { Folder, Brain, Loader2 } from "lucide-react";

interface ImportSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportSkillDialog({
  open,
  onOpenChange,
}: ImportSkillDialogProps) {
  const { importSkill } = useSkillsStore();
  const { activeProject } = useProjectStore();
  const [isLoading, setIsLoading] = useState(false);

  const handleBrowse = async () => {
    if (!window.electronAPI?.skills?.browse) {
      toast.error("Browse not available", {
        description: "This feature requires the Electron desktop app",
      });
      return;
    }

    if (!activeProject) {
      toast.error("No active project", {
        description: "Please open a project first",
      });
      return;
    }

    const path = await window.electronAPI.skills.browse();
    if (path) {
      setIsLoading(true);
      const skillId = await importSkill(activeProject.id, path);
      setIsLoading(false);

      if (skillId) {
        toast.success("Skill imported successfully");
        onOpenChange(false);
      } else {
        toast.error("Failed to import skill", {
          description: "Make sure the folder contains a valid Skill.md file",
        });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            Import Skill
          </DialogTitle>
          <DialogDescription>
            Import a skill folder containing a Skill.md file into your project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Instructions */}
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <p className="font-medium mb-2">Skill folder requirements:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                Must contain a <code className="text-xs">Skill.md</code> file
              </li>
              <li>Skill.md should have YAML frontmatter with name/description</li>
              <li>
                Can include reference files (REFERENCE.md, CONCEPTS.md, etc.)
              </li>
            </ul>
          </div>

          {/* Browse button */}
          <Button
            type="button"
            variant="outline"
            className="w-full h-20"
            onClick={handleBrowse}
            disabled={isLoading || !activeProject}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Folder className="h-5 w-5 mr-2" />
                Browse for Skill Folder...
              </>
            )}
          </Button>

          {!activeProject && (
            <p className="text-xs text-destructive text-center">
              Please open a project to import skills
            </p>
          )}

          {/* Tip */}
          <p className="text-xs text-muted-foreground text-center">
            Tip: Skills are typically found in{" "}
            <code className="text-xs">.claude/skills/</code> folder
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
