"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debugLog, debugError } from "@/lib/debug-config";
import { createObjectURL } from "@/lib/blob-manager";
import {
  AlertCircle,
  Clock,
  Grid3X3,
  Hash,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStickersStore } from "@/stores/stickers-store";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import {
  buildIconSvgUrl,
  getCollection,
  POPULAR_COLLECTIONS,
} from "@/lib/iconify-api";
import { downloadStickerAsFile } from "@/lib/sticker-downloader";
import type { IconSet } from "@/lib/iconify-api";
import { cn } from "@/lib/utils";

// Types
interface StickerItemProps {
  icon: string;
  name: string;
  collection: string;
  onSelect: (iconId: string, name: string) => void;
  isSelected?: boolean;
}

// StickerItem Component
function StickerItem({
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
      const svgUrl = buildIconSvgUrl(collection, icon, {
        // Force white for maximum contrast in dark UI
        color: "#FFFFFF",
        width: 32,
        height: 32,
      });
      // debugLog("[StickerItem] Built SVG URL:", { collection, icon, svgUrl });
      setImageUrl(svgUrl);
    } catch (error) {
      debugError("[StickerItem] Error building SVG URL:", error);
      setHasError(true);
      setIsLoading(false);
    }
  }, [icon, collection]);

  const handleClick = () => {
    const iconId = `${collection}:${icon}`;
    onSelect(iconId, name || icon);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "relative flex h-14 w-14 flex-col items-center justify-center rounded-md border border-border/80 bg-slate-800/50 transition-colors hover:border-primary hover:bg-slate-700/70 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              isSelected && "border-primary bg-slate-700/70"
            )}
            onClick={handleClick}
            disabled={hasError || !imageUrl}
            data-testid="sticker-item"
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
                className={cn(
                  "h-8 w-8 object-contain",
                  (isLoading || hasError) && "hidden"
                )}
                onLoad={() => {
                  setIsLoading(false);
                }}
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
    </TooltipProvider>
  );
}

// Fallback icons for when API calls fail or return no data
const FALLBACK_ICONS: Record<string, string[]> = {
  "heroicons": ["home", "user", "cog", "heart", "star", "check"],
  "tabler": ["home", "user", "settings", "heart", "star", "check"],
  "material-symbols": [
    "home",
    "person",
    "settings",
    "favorite",
    "star",
    "check",
  ],
  "simple-icons": [
    "github",
    "google",
    "facebook",
    "twitter",
    "instagram",
    "youtube",
  ],
};

// CollectionContent Component
interface CollectionContentProps {
  collectionPrefix: string;
  collections: IconSet[];
  onSelect: (iconId: string, name: string) => void;
}

function CollectionContent({
  collectionPrefix,
  collections,
  onSelect,
}: CollectionContentProps) {
  const [collectionIcons, setCollectionIcons] = useState<string[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(true);

  useEffect(() => {
    const fetchCollectionIcons = async () => {
      setLoadingCollection(true);
      try {
        // First, check if we have this collection in our store
        const collection = collections.find(
          (c) => c.prefix === collectionPrefix
        );

        // Try to get sample icons from POPULAR_COLLECTIONS first
        const popularCollection = POPULAR_COLLECTIONS.find(
          (c) => c.prefix === collectionPrefix
        );

        if (popularCollection?.samples) {
          setCollectionIcons(popularCollection.samples);
        } else {
          // Try to fetch actual icons from the API
          try {
            const collectionInfo = await getCollection(collectionPrefix);

            // Get icons from the collection
            let icons: string[] = [];

            // Try uncategorized first
            if (
              collectionInfo.uncategorized &&
              collectionInfo.uncategorized.length > 0
            ) {
              icons = collectionInfo.uncategorized;
            }
            // Then try categories
            else if (collectionInfo.categories) {
              const categoryArrays = Object.values(collectionInfo.categories);
              if (categoryArrays.length > 0) {
                // Flatten all categories and take first 30
                icons = categoryArrays.flat().slice(0, 30);
              }
            }

            // If still no icons, try a fallback based on collection prefix
            if (icons.length === 0) {
              icons = FALLBACK_ICONS[collectionPrefix] || [];
            }

            setCollectionIcons(icons.slice(0, 20)); // Limit to 20 for performance
          } catch (error) {
            // Use fallback icons on error
            setCollectionIcons(FALLBACK_ICONS[collectionPrefix] || []);
          }
        }
      } catch (error) {
        setCollectionIcons([]);
      } finally {
        setLoadingCollection(false);
      }
    };

    fetchCollectionIcons();
  }, [collectionPrefix, collections]);

  if (loadingCollection) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (collectionIcons.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <AlertCircle className="mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No icons available for this collection
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-2.5 p-3 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 [mask-image:linear-gradient(to_bottom,black_92%,transparent)]">
      {collectionIcons.map((iconName) => (
        <StickerItem
          key={`${collectionPrefix}:${iconName}`}
          icon={iconName}
          name={iconName}
          collection={collectionPrefix}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// Main StickersView Component
export function StickersView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<string>("all");
  const [isSearching, setIsSearching] = useState(false);

  const {
    collections,
    searchResults,
    recentStickers,
    isLoading,
    error,
    fetchCollections,
    searchIcons,
    addRecentSticker,
  } = useStickersStore();

  const { addMediaItem } = useMediaStore();
  const { activeProject } = useProjectStore();

  // Load collections on mount
  useEffect(() => {
    if (collections.length === 0) {
      fetchCollections();
    }
  }, [collections.length, fetchCollections]);

  // Search functionality with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        await searchIcons(searchQuery);
      } catch (error) {
        toast.error("Failed to search icons");
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchIcons]);

  const handleStickerSelect = useCallback(
    async (iconId: string, name: string) => {
      console.log("[StickersView] handleStickerSelect called:", {
        iconId,
        name,
      });
      debugLog("[StickersView] handleStickerSelect called:", {
        iconId,
        name,
      });

      if (!activeProject) {
        console.error("[StickersView] No active project");
        debugError("[StickersView] No active project");
        toast.error("No project selected");
        return;
      }

      try {
        // Download sticker as File object (no blob URLs!)
        console.log("[StickersView] Downloading sticker as File:", iconId);
        debugLog("[StickersView] Downloading sticker as File:", iconId);
        const svgFile = await downloadStickerAsFile(iconId, name);

        console.log("[StickersView] Sticker downloaded as File:", {
          name: svgFile.name,
          size: svgFile.size,
          type: svgFile.type,
        });
        debugLog("[StickersView] Sticker downloaded as File:", {
          name: svgFile.name,
          size: svgFile.size,
          type: svgFile.type,
        });

        // Add media item directly with File object
        // Create URL from the File object for immediate preview
        const fileUrl = createObjectURL(svgFile, "stickers-svg-upload");
        console.log("[StickersView] Created file URL:", fileUrl);

        const mediaItemData = {
          name: svgFile.name,
          type: "image" as const,
          file: svgFile,
          url: fileUrl,
          thumbnailUrl: fileUrl,
          width: 512,
          height: 512,
          duration: 0,
        };

        console.log(
          "[StickersView] Adding media item to project:",
          activeProject.id
        );
        console.log("[StickersView] Media item data:", mediaItemData);
        debugLog(
          "[StickersView] Adding media item to project:",
          activeProject.id
        );

        const mediaId = await addMediaItem(activeProject.id, mediaItemData);

        console.log("[StickersView] Media item added successfully");
        debugLog("[StickersView] Media item added successfully");

        // Add to timeline at current playback position
        const mediaItem = useMediaStore
          .getState()
          .mediaItems.find((item) => item.id === mediaId);
        if (mediaItem) {
          const currentTime = usePlaybackStore.getState().currentTime;
          const timelineStore = useTimelineStore.getState();
          const wasAdded = timelineStore.addMediaAtTime(mediaItem, currentTime);

          if (!wasAdded) {
            toast.error(`Could not add ${name} — overlaps existing element`);
            return;
          }

          // Set initial transforms so sticker renders as positioned overlay.
          // Find the just-added element by matching mediaId and startTime.
          const newEl = timelineStore.tracks
            .flatMap((t) => t.elements)
            .find(
              (e): e is import("@/types/timeline").MediaElement =>
                e.type === "media" &&
                e.startTime === currentTime &&
                (e as import("@/types/timeline").MediaElement).mediaId ===
                  mediaId &&
                e.width === undefined
            );
          if (newEl) {
            timelineStore.updateElementTransform(
              newEl.id,
              {
                position: { x: 0, y: 0 },
                size: { width: 200, height: 200 },
              },
              { pushHistory: false }
            );
          }

          debugLog("[StickersView] Added sticker to timeline at", currentTime);
        }

        // Add to recent stickers
        addRecentSticker(iconId, name);
        debugLog("[StickersView] Added to recent stickers");

        toast.success(`Added ${name} to timeline`);
      } catch (error) {
        debugError("[StickersView] Error adding sticker:", error);
        toast.error("Failed to add sticker to project");
      }
    },
    [activeProject, addMediaItem, addRecentSticker]
  );

  const renderSearchResults = () => {
    if (isSearching) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (searchResults.length === 0 && searchQuery) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">No icons found</p>
          <p className="text-muted-foreground">
            Try searching with different keywords
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-6 gap-2.5 p-3 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 [mask-image:linear-gradient(to_bottom,black_92%,transparent)]">
        {searchResults.map((result) => {
          const [collection, iconName] = result.split(":");
          return (
            <StickerItem
              key={result}
              icon={iconName}
              name={iconName}
              collection={collection}
              onSelect={handleStickerSelect}
            />
          );
        })}
      </div>
    );
  };

  const renderRecentStickers = () => {
    if (recentStickers.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Clock className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No recent stickers yet
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-6 gap-2.5 p-3 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 [mask-image:linear-gradient(to_bottom,black_92%,transparent)]">
        {recentStickers.map((sticker) => {
          const [collection, iconName] = sticker.iconId.split(":");
          return (
            <StickerItem
              key={sticker.iconId}
              icon={iconName}
              name={sticker.name}
              collection={collection}
              onSelect={handleStickerSelect}
            />
          );
        })}
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
        <p className="text-lg font-medium">Failed to load stickers</p>
        <p className="text-muted-foreground">{error}</p>
        <Button
          onClick={() => fetchCollections()}
          className="mt-4"
          variant="outline"
        >
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="stickers-panel">
      {/* Search Bar */}
      <div className="border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
          <Input
            placeholder="Search stickers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 transform p-0 hover:bg-accent rounded"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {searchQuery ? (
          <ScrollArea className="h-full">{renderSearchResults()}</ScrollArea>
        ) : (
          <Tabs
            value={selectedCollection}
            onValueChange={setSelectedCollection}
            className="h-full"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="recent" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent
              </TabsTrigger>
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Grid3X3 className="h-4 w-4" />
                All
              </TabsTrigger>
              <TabsTrigger
                value="simple-icons"
                className="flex items-center gap-2"
              >
                <Hash className="h-4 w-4" />
                Brands
              </TabsTrigger>
              <TabsTrigger value="tabler" className="flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Tabler
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recent" className="mt-0 h-full">
              <ScrollArea className="h-full">
                {renderRecentStickers()}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="all" className="mt-0 h-full">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-6">
                  {POPULAR_COLLECTIONS.map((collection) => (
                    <div key={collection.prefix}>
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          {collection.name}
                        </h3>
                        <Badge variant="secondary">{collection.prefix}</Badge>
                      </div>
                      <CollectionContent
                        collectionPrefix={collection.prefix}
                        collections={collections}
                        onSelect={handleStickerSelect}
                      />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="simple-icons" className="mt-0 h-full">
              <ScrollArea className="h-full">
                <CollectionContent
                  collectionPrefix="simple-icons"
                  collections={collections}
                  onSelect={handleStickerSelect}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="tabler" className="mt-0 h-full">
              <ScrollArea className="h-full">
                <CollectionContent
                  collectionPrefix="tabler"
                  collections={collections}
                  onSelect={handleStickerSelect}
                />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-2 text-center text-xs text-muted-foreground">
        Icons provided by{" "}
        <a
          href="https://iconify.design"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Iconify
        </a>
      </div>
    </div>
  );
}
