"use client";

import type { Skill } from "@/types/skill";
import { Button } from "@/components/ui/button";
import { Brain, Trash2, Play } from "lucide-react";
import { toast } from "sonner";

interface SkillCardProps {
  skill: Skill;
  onDelete: () => void;
}

export function SkillCard({ skill, onDelete }: SkillCardProps) {
  const handleRunWithGemini = () => {
    // TODO: Integrate with Gemini terminal when available
    // For now, just show a toast with skill info
    toast.info(`Skill "${skill.name}" ready`, {
      description: "Gemini terminal integration coming soon",
    });
  };

  const handleDelete = () => {
    if (window.confirm(`Delete skill "${skill.name}" from this project?`)) {
      onDelete();
      toast.success(`Deleted "${skill.name}"`);
    }
  };

  return (
    <div className="border border-border rounded-lg p-3 bg-card hover:bg-accent/5 transition-colors">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-purple-500/10">
          <Brain className="h-5 w-5 text-purple-500" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{skill.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {skill.description}
          </p>

          {skill.dependencies && (
            <p className="text-xs text-muted-foreground mt-1">
              Requires: {skill.dependencies}
            </p>
          )}

          {skill.additionalFiles.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              +{skill.additionalFiles.length} reference file
              {skill.additionalFiles.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="flex-1"
          onClick={handleRunWithGemini}
        >
          <Play className="h-3 w-3 mr-1" />
          Run
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDelete}
          aria-label="Delete skill"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
