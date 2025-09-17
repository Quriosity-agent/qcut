import React from "react";
import { Button } from "@/components/ui/button";
import { Group, Ungroup } from "lucide-react";
import { cn } from "@/lib/utils";

interface GroupControlsProps {
  selectedCount: number;
  hasGroups: boolean;
  onCreateGroup: () => void;
  onUngroup: () => void;
  className?: string;
}

export const GroupControls: React.FC<GroupControlsProps> = ({
  selectedCount,
  hasGroups,
  onCreateGroup,
  onUngroup,
  className,
}) => {
  const canGroup = selectedCount >= 2;
  const canUngroup = hasGroups && selectedCount > 0;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="text"
        size="sm"
        onClick={onCreateGroup}
        disabled={!canGroup}
        title={`Group Selected Objects (${selectedCount} selected)`}
        className="h-8 w-8 p-0"
      >
        <Group size={14} />
      </Button>
      <Button
        variant="text"
        size="sm"
        onClick={onUngroup}
        disabled={!canUngroup}
        title="Ungroup Selected Objects"
        className="h-8 w-8 p-0"
      >
        <Ungroup size={14} />
      </Button>
    </div>
  );
};

export default GroupControls;
