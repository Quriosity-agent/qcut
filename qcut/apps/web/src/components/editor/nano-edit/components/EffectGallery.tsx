import React, { useState } from "react";
import { useNanoEditStore } from "@/stores/nano-edit-store";
import { FalAiService } from "@/services/ai/fal-ai-service";
import { toast } from "@/hooks/use-toast";

export interface ImageEffect {
  id: string;
  name: string;
  prompt: string;
  category: "artistic" | "photography" | "vintage" | "modern" | "fantasy";
  preview?: string;
  description: string;
}

// Static categories list
const CATEGORIES = [
  "all",
  ...Array.from(new Set(["artistic", "photography", "vintage", "modern", "fantasy"] as const)),
];

// Static icon mapping for categories
const getCategoryIcon = (category: string): string => {
  switch (category) {
    case "artistic":
      return "🎨";
    case "photography":
      return "📸";
    case "vintage":
      return "📼";
    case "modern":
      return "✨";
    case "fantasy":
      return "🧙";
    default:
      return "🎯";
  }
};

const EFFECT_PRESETS: ImageEffect[] = [
  {
    id: "oil-painting",
    name: "Oil Painting",
    prompt:
      "Transform into an oil painting style with visible brush strokes and artistic texture",
    category: "artistic",
    description: "Classic oil painting effect with rich textures",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    prompt:
      "Convert to watercolor painting style with soft edges and flowing colors",
    category: "artistic",
    description: "Soft watercolor effect with flowing paint",
  },
  {
    id: "vintage-film",
    name: "Vintage Film",
    prompt: "Apply vintage film photography look with grain and warm tones",
    category: "vintage",
    description: "Classic film photography aesthetic",
  },
  {
    id: "noir",
    name: "Film Noir",
    prompt:
      "Transform to black and white film noir style with dramatic shadows",
    category: "vintage",
    description: "Dramatic black and white cinema look",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    prompt:
      "Apply cyberpunk futuristic style with neon colors and digital effects",
    category: "modern",
    description: "Futuristic neon cyberpunk aesthetic",
  },
  {
    id: "fantasy",
    name: "Fantasy Art",
    prompt:
      "Transform into fantasy art style with magical and ethereal elements",
    category: "fantasy",
    description: "Magical fantasy illustration style",
  },
  {
    id: "professional",
    name: "Professional",
    prompt: "Enhance for professional photography look with balanced lighting",
    category: "photography",
    description: "Clean professional photography enhancement",
  },
  {
    id: "sepia",
    name: "Sepia Tone",
    prompt: "Apply classic sepia tone effect for vintage monochromatic look",
    category: "vintage",
    description: "Classic sepia photography tone",
  },
];

export const EffectGallery: React.FC = () => {
  const { addAsset, isProcessing, setProcessing, assets } = useNanoEditStore();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [processingEffectId, setProcessingEffectId] = useState<string | null>(null);


  // Filter effects by category
  const filteredEffects =
    selectedCategory === "all"
      ? EFFECT_PRESETS
      : EFFECT_PRESETS.filter((e) => e.category === selectedCategory);

  const applyEffect = async (effect: ImageEffect, targetAssetId: string) => {
    if (!targetAssetId) return;

    setProcessing(true);
    setProcessingEffectId(effect.id);

    try {
      const targetAsset = assets.find((a) => a.id === targetAssetId);
      if (!targetAsset) return;

      const enhancedPrompt = `${effect.prompt}. Apply this effect to enhance the image.`;

      const imageUrls = await FalAiService.editImages(
        enhancedPrompt,
        [targetAsset.url],
        {
          num_images: 1,
          output_format: "png",
        }
      );

      if (imageUrls.length > 0) {
        const newAsset = {
          id: crypto.randomUUID(),
          type: "overlay" as const,
          url: imageUrls[0],
          projectId: targetAsset.projectId,
          createdAt: new Date(),
          prompt: `${effect.name} effect applied to ${targetAsset.type}`,
          dimensions: targetAsset.dimensions,
        };

        addAsset(newAsset);
        
        // Show success notification
        toast({
          title: "Effect Applied Successfully",
          description: `${effect.name} effect has been applied to your image.`,
        });
      } else {
        // Handle case where no images were returned
        toast({
          title: "No Result",
          description: "The effect was processed but no image was returned. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error applying effect:", error);
      
      // Show user-friendly error notification
      const errorMessage = error instanceof Error 
        ? error.message 
        : "An unexpected error occurred while applying the effect.";
      
      toast({
        title: "Failed to Apply Effect",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
      setProcessingEffectId(null);
    }
  };


  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="text-2xl">🎭</div>
        <div>
          <h4 className="font-semibold text-white">Effect Gallery</h4>
          <p className="text-sm text-gray-400">
            Apply artistic effects to your images
          </p>
        </div>
      </div>

      {/* Asset Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Select Image to Transform
        </label>
        <select
          value={selectedAsset || ""}
          onChange={(e) => setSelectedAsset(e.target.value || null)}
          disabled={isProcessing || assets.length === 0}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        >
          <option value="">Choose an image...</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.type}: {asset.prompt?.slice(0, 40) || asset.id.slice(0, 8)}
              ...
            </option>
          ))}
        </select>
      </div>

      {/* Category Filter */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Effect Category
        </label>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              disabled={isProcessing}
              aria-pressed={selectedCategory === category}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                selectedCategory === category
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {category !== "all" ? getCategoryIcon(category) : "🌟"}{" "}
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Effects Grid */}
      <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
        {filteredEffects.map((effect) => {
          const isThisEffectProcessing = processingEffectId === effect.id;
          
          return (
            <button
              key={effect.id}
              type="button"
              onClick={() => selectedAsset && applyEffect(effect, selectedAsset)}
              disabled={isProcessing || !selectedAsset}
              className={`p-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed group relative ${
                isThisEffectProcessing ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="text-lg flex-shrink-0">
                  {isThisEffectProcessing ? (
                    <span className="inline-block animate-spin">⏳</span>
                  ) : (
                    getCategoryIcon(effect.category)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h5 className="text-sm font-medium text-white truncate group-hover:text-blue-300">
                    {effect.name}
                  </h5>
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                    {isThisEffectProcessing ? 'Applying effect...' : effect.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {filteredEffects.length === 0 && (
        <div className="text-center py-4 text-gray-400 text-sm">
          No effects found for "{selectedCategory}" category
        </div>
      )}

      {/* Usage Tips */}
      <div className="text-xs text-gray-400 bg-gray-900 p-3 rounded space-y-1">
        <div>
          <strong>💡 How to use:</strong>
        </div>
        <div>1. Select an image from your generated assets</div>
        <div>2. Choose an effect category and click an effect</div>
        <div>3. Wait for the AI to apply the transformation</div>
        <div>4. The result will be added to your assets</div>
      </div>
    </div>
  );
};

export default EffectGallery;
