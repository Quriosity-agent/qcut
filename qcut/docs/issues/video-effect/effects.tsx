"use client";

import { useEffect, useState, useMemo } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import {
  Loader2,
  Grid3X3,
  Sparkles,
  Palette,
  Camera,
  Film,
  Zap,
  Search,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EffectCategory } from "@/types/effects";
import { DraggableMediaItem } from "@/components/ui/draggable-item";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

const categoryIcons: Record<EffectCategory | "all", JSX.Element> = {
  all: <Grid3X3 className="w-4 h-4" />,
  basic: <Zap className="w-4 h-4" />,
  color: <Palette className="w-4 h-4" />,
  artistic: <Sparkles className="w-4 h-4" />,
  vintage: <Camera className="w-4 h-4" />,
  cinematic: <Film className="w-4 h-4" />,
  distortion: <Settings className="w-4 h-4" />,
};

export function EffectsView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const {
    presets,
    selectedCategory,
    setSelectedCategory,
    applyEffect,
    activeEffects,
    getElementEffects,
  } = useEffectsStore();
  
  const { selectedElementId } = useTimelineStore();
  const { currentTime } = usePlaybackStore();
  const { project } = useProjectStore();

  // Filter presets based on category and search
  const filteredPresets = useMemo(() => {
    let filtered = presets;
    
    // Filter by category
    if (selectedCategory !== "all") {
      filtered = filtered.filter(preset => preset.category === selectedCategory);
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        preset =>
          preset.name.toLowerCase().includes(query) ||
          preset.description.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [presets, selectedCategory, searchQuery]);

  // Get effects for selected element
  const selectedElementEffects = selectedElementId
    ? getElementEffects(selectedElementId)
    : [];

  const handleApplyEffect = async (presetId: string) => {
    if (!selectedElementId) {
      toast.error("Please select an element on the timeline first");
      return;
    }
    
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    
    setIsLoading(true);
    try {
      applyEffect(selectedElementId, preset);
      toast.success(`Applied ${preset.name} effect`);
    } catch (error) {
      toast.error("Failed to apply effect");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const { loadMoreRef, hasMore } = useInfiniteScroll({
    items: filteredPresets,
    itemsPerPage: 20,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search effects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs
        value={selectedCategory}
        onValueChange={(value) => setSelectedCategory(value as EffectCategory | "all")}
        className="flex-1"
      >
        <TabsList className="w-full justify-start px-4 h-auto flex-wrap">
          {(["all", "basic", "color", "artistic", "vintage", "cinematic", "distortion"] as const).map(
            (category) => (
              <TabsTrigger
                key={category}
                value={category}
                className="flex items-center gap-2"
              >
                {categoryIcons[category]}
                <span className="capitalize">{category}</span>
              </TabsTrigger>
            )
          )}
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value={selectedCategory} className="p-4">
            {/* Selected Element Effects */}
            {selectedElementEffects.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold mb-3">Active Effects</h3>
                <div className="space-y-2">
                  {selectedElementEffects.map((effect) => (
                    <div
                      key={effect.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => {
                            // Toggle effect enabled state
                            useEffectsStore.getState().toggleEffect(selectedElementId!, effect.id);
                          }}
                        >
                          {effect.enabled ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                        </Button>
                        <span className="text-sm">{effect.name}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => {
                          useEffectsStore.getState().removeEffect(selectedElementId!, effect.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Separator className="mt-4" />
              </div>
            )}

            {/* Effect Presets Grid */}
            <div className="grid grid-cols-2 gap-3">
              {filteredPresets.map((preset) => (
                <TooltipProvider key={preset.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "relative group cursor-pointer rounded-lg border p-3 transition-all hover:border-primary hover:shadow-md",
                          isLoading && "pointer-events-none opacity-50"
                        )}
                        onClick={() => handleApplyEffect(preset.id)}
                      >
                        {/* Effect Icon */}
                        <div className="text-2xl mb-2">{preset.icon}</div>
                        
                        {/* Effect Name */}
                        <h4 className="font-medium text-sm">{preset.name}</h4>
                        
                        {/* Effect Description */}
                        <p className="text-xs text-muted-foreground mt-1">
                          {preset.description}
                        </p>
                        
                        {/* Apply Button (shown on hover) */}
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                          <Button size="sm" variant="secondary">
                            <Plus className="w-3 h-3 mr-1" />
                            Apply
                          </Button>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Click to apply {preset.name}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
              
              {/* Load more trigger */}
              {hasMore && (
                <div ref={loadMoreRef} className="col-span-2 flex justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
            </div>

            {/* Empty State */}
            {filteredPresets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles className="w-12 h-12 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  No effects found matching your search
                </p>
              </div>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}