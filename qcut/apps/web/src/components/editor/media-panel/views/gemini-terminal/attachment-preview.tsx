"use client";

import { cn } from "@/lib/utils";
import { X, ImageIcon, Video, Music, File } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AttachmentPreviewProps {
  attachment: {
    id: string;
    name: string;
    type: string;
    thumbnailUrl?: string;
  };
  onRemove?: () => void;
  compact?: boolean;
}

export function AttachmentPreview({
  attachment,
  onRemove,
  compact,
}: AttachmentPreviewProps) {
  const iconMap: Record<string, typeof ImageIcon> = {
    image: ImageIcon,
    video: Video,
    audio: Music,
  };
  const Icon = iconMap[attachment.type] || File;

  return (
    <div
      className={cn(
        "relative rounded border bg-muted/50 overflow-hidden flex-shrink-0",
        compact ? "w-12 h-12" : "w-16 h-16"
      )}
      title={attachment.name}
    >
      {attachment.thumbnailUrl ? (
        <img
          src={attachment.thumbnailUrl}
          alt={attachment.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      {onRemove && (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="absolute -top-1 -right-1 h-4 w-4 rounded-full"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
