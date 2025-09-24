import { useState } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { EffectCategory, EffectPreset } from "@/types/effects";

export default function EffectsView() {
  const { presets, selectedCategory, setSelectedCategory, applyEffect } =
    useEffectsStore();
  const { selectedElements } = useTimelineStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [draggedEffect, setDraggedEffect] = useState<EffectPreset | null>(null);

  const categories: Array<EffectCategory | "all"> = [
    "all",
    "basic",
    "color",
    "artistic",
    "vintage",
    "cinematic",
    "distortion",
  ];

  const filteredPresets = presets.filter((preset) => {
    const matchesCategory =
      selectedCategory === "all" || preset.category === selectedCategory;
    const matchesSearch =
      preset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      preset.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleApplyEffect = (
    preset: EffectPreset & { isImplemented?: boolean }
  ) => {
    // Check if effect is implemented
    if (preset.isImplemented === false) {
      toast.info(`${preset.name} effect is coming soon!`);
      return;
    }

    // Get selected element from timeline store
    const selectedElementId = selectedElements[0]?.elementId;
    if (selectedElementId) {
      applyEffect(selectedElementId, preset);
      toast.success(`Applied ${preset.name} effect`);
    } else {
      toast.info("Please select an element on the timeline first");
    }
  };

  const handleDragStart = (e: React.DragEvent, preset: EffectPreset) => {
    setDraggedEffect(preset);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        type: "effect",
        preset,
      })
    );

    // Add visual feedback
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.opacity = "0.5";
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(
      dragImage,
      e.nativeEvent.offsetX,
      e.nativeEvent.offsetY
    );
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  const handleDragEnd = () => {
    setDraggedEffect(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 border-b">
        <Input
          type="search"
          placeholder="Search effects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full"
          aria-label="Search effects"
        />
      </div>

      {/* Category Tabs */}
      <Tabs
        value={selectedCategory}
        onValueChange={(value) =>
          setSelectedCategory(value as EffectCategory | "all")
        }
      >
        <TabsList className="w-full justify-start px-4">
          {categories.map((category) => (
            <TabsTrigger key={category} value={category} className="capitalize">
              {category}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value={selectedCategory}
          className="flex-1 overflow-y-auto"
        >
          {/* Effects Grid */}
          <div className="grid grid-cols-2 gap-2 p-4">
            {filteredPresets.map((preset) => {
              const isImplemented = (preset as any).isImplemented !== false;
              return (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-20 flex flex-col items-center justify-center gap-1 relative",
                    isImplemented
                      ? "hover:bg-accent cursor-move"
                      : "opacity-50 cursor-not-allowed",
                    draggedEffect?.id === preset.id && "opacity-50"
                  )}
                  onClick={() => handleApplyEffect(preset as any)}
                  aria-label={`Apply ${preset.name} effect`}
                  draggable={isImplemented}
                  onDragStart={
                    isImplemented
                      ? (e) => handleDragStart(e, preset)
                      : undefined
                  }
                  onDragEnd={isImplemented ? handleDragEnd : undefined}
                  title={
                    isImplemented
                      ? `${preset.name} - Drag to timeline element to apply`
                      : `${preset.name} - Coming soon!`
                  }
                  disabled={!isImplemented}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {preset.icon}
                  </span>
                  <span className="text-xs font-medium">{preset.name}</span>
                  {!isImplemented && (
                    <span className="absolute top-1 right-1 text-xs text-muted-foreground">
                      🚧
                    </span>
                  )}
                </Button>
              );
            })}
          </div>

          {filteredPresets.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              No effects found matching your search.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
