"use client";

import { useSegmentationStore } from "@/stores/segmentation-store";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Trash2 } from "lucide-react";

/**
 * SegmentationControls
 *
 * Action buttons for segmentation operations.
 */
export function SegmentationControls() {
	const { objects, masks, clearObjects, clearSource, clearCurrentPrompts } =
		useSegmentationStore();

	const handleDownloadMasks = async () => {
		if (masks.length === 0) return;

		// Download each mask
		for (let i = 0; i < masks.length; i++) {
			const mask = masks[i];
			if (!mask.url) continue;

			try {
				const response = await fetch(mask.url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);

				const link = document.createElement("a");
				link.href = url;
				link.download = `mask_${i + 1}.png`;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);

				URL.revokeObjectURL(url);
			} catch (error) {
				console.error(`Failed to download mask ${i + 1}:`, error);
			}
		}
	};

	const handleReset = () => {
		clearObjects();
		clearCurrentPrompts();
	};

	const handleClearAll = () => {
		clearSource();
		clearObjects();
		clearCurrentPrompts();
	};

	return (
		<div className="flex items-center gap-2">
			{/* Download Masks */}
			{masks.length > 0 && (
				<Button
					variant="outline"
					size="sm"
					onClick={handleDownloadMasks}
					className="flex items-center gap-1"
				>
					<Download className="w-4 h-4" />
					Download Masks
				</Button>
			)}

			{/* Reset Objects */}
			{objects.length > 0 && (
				<Button
					variant="outline"
					size="sm"
					onClick={handleReset}
					className="flex items-center gap-1"
				>
					<RefreshCw className="w-4 h-4" />
					Reset
				</Button>
			)}

			{/* Clear All */}
			<Button
				variant="text"
				size="sm"
				onClick={handleClearAll}
				className="flex items-center gap-1 text-destructive hover:text-destructive"
			>
				<Trash2 className="w-4 h-4" />
				Clear All
			</Button>
		</div>
	);
}
