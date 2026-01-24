/**
 * Remotion Components View
 *
 * Panel for browsing and adding Remotion components to the timeline.
 * Displays component library organized by category with search and preview.
 *
 * @module components/editor/media-panel/views/remotion
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  Layers,
  Loader2,
  Play,
  Plus,
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
import { cn } from "@/lib/utils";
import { useRemotionStore, useComponentsByCategory } from "@/stores/remotion-store";
import type { RemotionComponentDefinition, RemotionComponentCategory } from "@/lib/remotion/types";
import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { generateUUID } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface ComponentCardProps {
  component: RemotionComponentDefinition;
  onAdd: (component: RemotionComponentDefinition) => void;
  onPreview?: (component: RemotionComponentDefinition) => void;
}

// ============================================================================
// Category Configuration
// ============================================================================

const CATEGORY_CONFIG: Record<RemotionComponentCategory, { label: string; description: string }> = {
  animation: { label: "Animations", description: "Animated graphics and motion effects" },
  scene: { label: "Scenes", description: "Full-screen compositions and backgrounds" },
  effect: { label: "Effects", description: "Visual effects and overlays" },
  template: { label: "Templates", description: "Pre-built video templates" },
  transition: { label: "Transitions", description: "Scene transition effects" },
  text: { label: "Text", description: "Animated text and typography" },
};

const CATEGORY_ORDER: RemotionComponentCategory[] = [
  "template",
  "scene",
  "animation",
  "text",
  "effect",
  "transition",
];

// ============================================================================
// Component Card
// ============================================================================

function ComponentCard({ component, onAdd, onPreview }: ComponentCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const durationSeconds = (component.durationInFrames / component.fps).toFixed(1);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "relative group rounded-lg border border-border/80 bg-slate-800/50",
              "transition-all cursor-pointer overflow-hidden",
              "hover:border-violet-500/50 hover:bg-slate-700/70",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => onAdd(component)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAdd(component);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`Add ${component.name} to timeline`}
          >
            {/* Thumbnail / Preview */}
            <div className="aspect-video bg-gradient-to-br from-violet-600/20 to-purple-600/20 flex items-center justify-center">
              {component.thumbnail ? (
                <img
                  src={component.thumbnail}
                  alt={component.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Layers className="w-8 h-8 text-violet-400" />
              )}

              {/* Hover overlay with actions */}
              {isHovered && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(component);
                    }}
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </Button>
                  {onPreview && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview(component);
                      }}
                    >
                      <Play className="w-3 h-3" />
                      Preview
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Component Info */}
            <div className="p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-foreground truncate">
                  {component.name}
                </span>
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  {durationSeconds}s
                </Badge>
              </div>
              {component.description && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {component.description}
                </p>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{component.name}</p>
            {component.description && (
              <p className="text-xs text-muted-foreground">{component.description}</p>
            )}
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>{component.width}x{component.height}</span>
              <span>{component.fps}fps</span>
              <span>{component.durationInFrames} frames</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// Category Section
// ============================================================================

interface CategorySectionProps {
  category: RemotionComponentCategory;
  components: RemotionComponentDefinition[];
  onAdd: (component: RemotionComponentDefinition) => void;
  onPreview?: (component: RemotionComponentDefinition) => void;
}

function CategorySection({ category, components, onAdd, onPreview }: CategorySectionProps) {
  const config = CATEGORY_CONFIG[category];

  if (components.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{config.label}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {components.length}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {components.map((component) => (
          <ComponentCard
            key={component.id}
            component={component}
            onAdd={onAdd}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({ searchQuery }: { searchQuery?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      {searchQuery ? (
        <>
          <Search className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">No components found</p>
          <p className="text-muted-foreground">
            No Remotion components match "{searchQuery}"
          </p>
        </>
      ) : (
        <>
          <Layers className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">No Remotion components</p>
          <p className="text-muted-foreground text-sm max-w-sm">
            Remotion components will appear here once registered.
            Components can be added from the built-in library or imported from your Remotion projects.
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function RemotionView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | RemotionComponentCategory>("all");

  // Get store state
  const { registeredComponents, isLoading, isInitialized, initialize } = useRemotionStore();
  const { addTrack, addElementToTrack, tracks } = useTimelineStore();
  const fps = useProjectStore((state) => state.activeProject?.fps ?? 30);

  // Get all components as array
  const allComponents = useMemo(() => {
    return Array.from(registeredComponents.values());
  }, [registeredComponents]);

  // Filter components by search query
  const filteredComponents = useMemo(() => {
    if (!searchQuery.trim()) {
      return allComponents;
    }

    const query = searchQuery.toLowerCase();
    return allComponents.filter(
      (comp) =>
        comp.name.toLowerCase().includes(query) ||
        comp.description?.toLowerCase().includes(query) ||
        comp.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [allComponents, searchQuery]);

  // Group components by category
  const componentsByCategory = useMemo(() => {
    const grouped: Record<RemotionComponentCategory, RemotionComponentDefinition[]> = {
      animation: [],
      scene: [],
      effect: [],
      template: [],
      transition: [],
      text: [],
    };

    for (const comp of filteredComponents) {
      grouped[comp.category].push(comp);
    }

    return grouped;
  }, [filteredComponents]);

  // Handle adding a component to the timeline
  const handleAddComponent = useCallback(
    (component: RemotionComponentDefinition) => {
      // Find or create a Remotion track
      let remotionTrack = tracks.find((t) => t.type === "remotion");
      let trackId: string;

      if (!remotionTrack) {
        // Create a new Remotion track - addTrack takes TrackType and returns trackId
        trackId = addTrack("remotion");
      } else {
        trackId = remotionTrack.id;
      }

      // Calculate duration in seconds
      const durationSeconds = component.durationInFrames / component.fps;

      // Add the element to the track
      addElementToTrack(trackId, {
        type: "remotion",
        name: component.name,
        duration: durationSeconds,
        startTime: 0, // Will be auto-positioned
        trimStart: 0,
        trimEnd: 0,
        componentId: component.id,
        props: { ...component.defaultProps },
        renderMode: "live",
      });

      toast.success(`Added "${component.name}" to timeline`);
    },
    [tracks, addTrack, addElementToTrack]
  );

  // Handle preview (placeholder for now)
  const handlePreview = useCallback((component: RemotionComponentDefinition) => {
    toast.info(`Preview for "${component.name}" coming soon`);
  }, []);

  // Initialize store if needed
  if (!isInitialized && !isLoading) {
    initialize();
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="remotion-panel">
      {/* Search Bar */}
      <div className="border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
          <Input
            placeholder="Search Remotion components..."
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
        {filteredComponents.length === 0 ? (
          <EmptyState searchQuery={searchQuery} />
        ) : (
          <Tabs
            value={activeCategory}
            onValueChange={(v) => setActiveCategory(v as "all" | RemotionComponentCategory)}
            className="h-full flex flex-col"
          >
            <TabsList className="mx-4 mt-2 grid grid-cols-4">
              <TabsTrigger value="all" className="text-xs">
                All
              </TabsTrigger>
              <TabsTrigger value="template" className="text-xs">
                Templates
              </TabsTrigger>
              <TabsTrigger value="animation" className="text-xs">
                Animations
              </TabsTrigger>
              <TabsTrigger value="text" className="text-xs">
                Text
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="flex-1 mt-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-6">
                  {CATEGORY_ORDER.map((category) => (
                    <CategorySection
                      key={category}
                      category={category}
                      components={componentsByCategory[category]}
                      onAdd={handleAddComponent}
                      onPreview={handlePreview}
                    />
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            {CATEGORY_ORDER.map((category) => (
              <TabsContent key={category} value={category} className="flex-1 mt-0">
                <ScrollArea className="h-full">
                  <div className="p-4">
                    {componentsByCategory[category].length > 0 ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {componentsByCategory[category].map((component) => (
                          <ComponentCard
                            key={component.id}
                            component={component}
                            onAdd={handleAddComponent}
                            onPreview={handlePreview}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Layers className="mb-4 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          No {CATEGORY_CONFIG[category].label.toLowerCase()} available
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-2 text-center text-xs text-muted-foreground">
        Powered by{" "}
        <a
          href="https://remotion.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-400 hover:underline"
        >
          Remotion
        </a>
      </div>
    </div>
  );
}

export default RemotionView;
