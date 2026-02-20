import { useState } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { EffectCategory, EffectPreset } from "@/types/effects";

// Gradient backgrounds that visually represent each effect
const EFFECT_GRADIENTS: Record<string, string> = {
	"brightness-increase":
		"linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)",
	"brightness-decrease":
		"linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)",
	"contrast-high":
		"linear-gradient(135deg, #000000 0%, #ffffff 50%, #000000 100%)",
	"saturation-boost":
		"linear-gradient(135deg, #ec4899 0%, #8b5cf6 33%, #06b6d4 66%, #10b981 100%)",
	desaturate: "linear-gradient(135deg, #6b7280 0%, #9ca3af 50%, #6b7280 100%)",
	sepia: "linear-gradient(135deg, #92400e 0%, #b45309 50%, #d4a574 100%)",
	grayscale: "linear-gradient(135deg, #1f2937 0%, #6b7280 50%, #d1d5db 100%)",
	"vintage-film":
		"linear-gradient(135deg, #78350f 0%, #a16207 50%, #ca8a04 100%)",
	dramatic: "linear-gradient(135deg, #0f172a 0%, #7c2d12 50%, #0f172a 100%)",
	"warm-filter":
		"linear-gradient(135deg, #dc2626 0%, #ea580c 50%, #f59e0b 100%)",
	"cool-filter":
		"linear-gradient(135deg, #1d4ed8 0%, #0891b2 50%, #06b6d4 100%)",
	chromatic:
		"linear-gradient(135deg, #ef4444 0%, #22c55e 33%, #3b82f6 66%, #ef4444 100%)",
	radiance: "linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fbbf24 100%)",
	cinematic: "linear-gradient(135deg, #0c0a09 0%, #292524 40%, #c2410c 100%)",
	"blur-soft": "linear-gradient(135deg, #94a3b8 0%, #cbd5e1 50%, #94a3b8 100%)",
	sharpen: "linear-gradient(135deg, #374151 0%, #e5e7eb 50%, #374151 100%)",
	emboss: "linear-gradient(135deg, #a8a29e 0%, #d6d3d1 50%, #78716c 100%)",
	"edge-detect":
		"linear-gradient(135deg, #000000 0%, #22c55e 50%, #000000 100%)",
	pixelate: "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%)",
	vignette: "radial-gradient(circle, #44403c 0%, #0c0a09 100%)",
	grain: "linear-gradient(135deg, #57534e 0%, #78716c 50%, #57534e 100%)",
	invert: "linear-gradient(135deg, #ffffff 0%, #000000 100%)",
	wave: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 50%, #7c3aed 100%)",
	twist:
		"conic-gradient(from 0deg, #7c3aed, #ec4899, #f59e0b, #10b981, #7c3aed)",
	bulge: "radial-gradient(circle, #60a5fa 0%, #1e40af 100%)",
	fisheye: "radial-gradient(circle, #a78bfa 0%, #4c1d95 100%)",
	"oil-painting":
		"linear-gradient(135deg, #b91c1c 0%, #15803d 33%, #1d4ed8 66%, #ca8a04 100%)",
	watercolor: "linear-gradient(135deg, #67e8f9 0%, #a5b4fc 50%, #f9a8d4 100%)",
	"pencil-sketch":
		"linear-gradient(135deg, #e5e7eb 0%, #9ca3af 50%, #374151 100%)",
	halftone: "linear-gradient(135deg, #000000 0%, #fafafa 50%, #000000 100%)",
	"fade-in": "linear-gradient(to top, #000000 0%, #6b7280 50%, #f3f4f6 100%)",
	"fade-out":
		"linear-gradient(to bottom, #f3f4f6 0%, #6b7280 50%, #000000 100%)",
	dissolve:
		"linear-gradient(135deg, #e2e8f0 0%, transparent 50%, #1e293b 100%)",
	wipe: "linear-gradient(to right, #1e293b 0%, #1e293b 50%, #f1f5f9 50%, #f1f5f9 100%)",
	overlay: "linear-gradient(135deg, #f97316 0%, #8b5cf6 100%)",
	multiply: "linear-gradient(135deg, #991b1b 0%, #1e3a5f 100%)",
	screen: "linear-gradient(135deg, #fef9c3 0%, #bfdbfe 100%)",
	"color-dodge":
		"linear-gradient(135deg, #fef08a 0%, #ffffff 50%, #fde047 100%)",
};

// Category accent colors
const CATEGORY_COLORS: Record<string, string> = {
	basic: "#60a5fa",
	color: "#a78bfa",
	artistic: "#f472b6",
	vintage: "#fbbf24",
	cinematic: "#f97316",
	distortion: "#34d399",
	transition: "#818cf8",
	composite: "#fb923c",
};

export default function EffectsView() {
	const { presets, selectedCategory, setSelectedCategory, applyEffect } =
		useEffectsStore();
	const { selectedElements, autoShowEffectsTrack } = useTimelineStore();
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
		if (preset.isImplemented === false) {
			toast.info(`${preset.name} effect is coming soon!`);
			return;
		}

		const selectedElementId = selectedElements[0]?.elementId;
		if (selectedElementId) {
			applyEffect(selectedElementId, preset);
			autoShowEffectsTrack();
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
			<div className="px-3 pt-3 pb-2">
				<Input
					type="search"
					placeholder="Search effects..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="w-full h-8 text-sm"
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
				<TabsList className="w-full justify-start px-3 h-8">
					{categories.map((category) => (
						<TabsTrigger
							key={category}
							value={category}
							className="capitalize text-xs px-2 py-1"
						>
							{category}
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent
					value={selectedCategory}
					className="flex-1 overflow-y-auto"
				>
					{/* Effects Grid - 3 columns, compact */}
					<div className="grid grid-cols-3 gap-1.5 p-3">
						{filteredPresets.map((preset) => {
							const isImplemented = (preset as any).isImplemented !== false;
							const gradient = EFFECT_GRADIENTS[preset.id];
							const categoryColor =
								CATEGORY_COLORS[preset.category] || "#6b7280";

							return (
								<button
									key={preset.id}
									type="button"
									className={cn(
										"group relative flex flex-col items-center rounded-lg overflow-hidden border border-border/50 transition-all duration-150",
										isImplemented
											? "hover:border-border hover:scale-[1.03] hover:shadow-lg cursor-move active:scale-[0.97]"
											: "opacity-40 cursor-not-allowed",
										draggedEffect?.id === preset.id && "opacity-50 scale-95"
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
											? `${preset.name} - ${preset.description}`
											: `${preset.name} - Coming soon!`
									}
									disabled={!isImplemented}
								>
									{/* Compact gradient card */}
									<div
										className="w-full h-10 relative flex items-center gap-1.5 px-2 rounded-lg"
										style={{
											background:
												gradient || "linear-gradient(135deg, #374151, #1f2937)",
										}}
									>
										<span
											className="text-sm drop-shadow-md shrink-0"
											aria-hidden="true"
										>
											{preset.icon}
										</span>
										<span className="text-xs font-semibold text-white truncate leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.9),0_0_6px_rgba(0,0,0,0.7)]">
											{preset.name}
										</span>

										{/* WIP badge */}
										{!isImplemented && (
											<span className="absolute top-0.5 right-1 text-[9px] leading-none">
												🚧
											</span>
										)}
									</div>
								</button>
							);
						})}
					</div>

					{filteredPresets.length === 0 && (
						<div className="p-8 text-center text-muted-foreground text-sm">
							No effects found matching your search.
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}
