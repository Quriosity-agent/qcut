"use client";

import {
	useSegmentationStore,
	OBJECT_COLORS,
} from "@/stores/ai/segmentation-store";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * MaskOverlay
 *
 * Controls for mask overlay opacity and bounding box visibility.
 */
export function MaskOverlay() {
	const {
		maskOpacity,
		setMaskOpacity,
		showBoundingBoxes,
		toggleBoundingBoxes,
		objects,
	} = useSegmentationStore();

	if (objects.length === 0) {
		return null;
	}

	return (
		<div className="space-y-4 p-3 bg-muted/30 rounded-lg">
			<h4 className="text-sm font-medium">Overlay Settings</h4>

			{/* Mask Opacity */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label className="text-xs">Mask Opacity</Label>
					<span className="text-xs text-muted-foreground">
						{Math.round(maskOpacity * 100)}%
					</span>
				</div>
				<Slider
					value={[maskOpacity]}
					onValueChange={([value]) => setMaskOpacity(value)}
					min={0}
					max={1}
					step={0.05}
					className="w-full"
				/>
			</div>

			{/* Show Bounding Boxes */}
			<div className="flex items-center justify-between">
				<Label className="text-xs">Show Bounding Boxes</Label>
				<Switch
					checked={showBoundingBoxes}
					onCheckedChange={toggleBoundingBoxes}
				/>
			</div>

			{/* Color Legend */}
			<div className="space-y-1">
				<Label className="text-xs">Object Colors</Label>
				<div className="flex flex-wrap gap-1">
					{objects.map((obj) => (
						<div
							key={obj.id}
							className="flex items-center gap-1 text-xs bg-background/50 rounded px-1.5 py-0.5"
						>
							<div
								className="w-2 h-2 rounded-full"
								style={{ backgroundColor: OBJECT_COLORS[obj.colorIndex].hex }}
							/>
							<span className="truncate max-w-[60px]">{obj.name}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
