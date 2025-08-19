"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buildIconSvgUrl } from "@/lib/iconify-api";
import { cn } from "@/lib/utils";
import { debugLog } from "@/lib/debug-config";
import type { StickerItemProps } from "../types/stickers.types";

export function StickerItem({
  icon,
  name,
  collection,
  onSelect,
  isSelected,
}: StickerItemProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>("");

  useEffect(() => {
    // Reset state for new icon
    setIsLoading(true);
    setHasError(false);

    try {
      // Prefer high-contrast preview color based on theme
      let preferredColor = "#111111"; // light theme default
      try {
        const isDark =
          document.documentElement.classList.contains("dark") ||
          window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;
        preferredColor = isDark ? "#FFFFFF" : "#111111";
      } catch {}

      const svgUrl = buildIconSvgUrl(collection, icon, {
        color: preferredColor,
        width: 40,
        height: 40,
      });
      setImageUrl(svgUrl);
    } catch (error) {
      debugLog(
        `[StickerItem] Failed to build SVG URL for ${collection}:${icon}:`,
        error
      );
      setHasError(true);
      setIsLoading(false);
    }
  }, [icon, collection]);

  const handleClick = () => {
    const iconId = `${collection}:${icon}`;
    onSelect(iconId, name || icon);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex h-16 w-16 flex-col items-center justify-center rounded-md border border-border/80 bg-muted/40 transition-colors hover:border-primary hover:bg-accent overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isSelected && "border-primary bg-accent"
          )}
          onClick={handleClick}
          disabled={hasError || !imageUrl}
          aria-pressed={Boolean(isSelected)}
          aria-label={(name || icon) + " (" + collection + ")"}
        >
          {isLoading && (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
          {hasError && !isLoading && (
            <AlertCircle className="h-6 w-6 text-destructive" />
          )}
          {imageUrl && (
            <img
              src={imageUrl}
              alt={name || icon}
              className={cn("h-10 w-10 object-contain", (isLoading || hasError) && "hidden")}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setHasError(true);
                setIsLoading(false);
              }}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-sm font-medium">
          {name || icon} ({collection})
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
