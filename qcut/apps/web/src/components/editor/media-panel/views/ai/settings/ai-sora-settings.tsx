/**
 * Sora 2 Settings Panel Component
 *
 * Renders settings panel for Sora 2 text-to-video models including:
 * - Duration selector (4, 8, 12 seconds)
 * - Aspect ratio selector (16:9, 9:16)
 * - Resolution selector (Pro only: auto, 720p, 1080p)
 *
 * @see ai-tsx-refactoring.md - Subtask 4.1
 */

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// ============================================
// Types
// ============================================

export type Sora2Duration = 4 | 8 | 12;
export type Sora2AspectRatio = "16:9" | "9:16";
export type Sora2Resolution = "auto" | "720p" | "1080p";

export interface AISora2SettingsProps {
	/** Current duration value */
	duration: Sora2Duration;
	/** Callback when duration changes */
	onDurationChange: (value: Sora2Duration) => void;
	/** Current aspect ratio */
	aspectRatio: Sora2AspectRatio;
	/** Callback when aspect ratio changes */
	onAspectRatioChange: (value: Sora2AspectRatio) => void;
	/** Current resolution (Pro only) */
	resolution: Sora2Resolution;
	/** Callback when resolution changes */
	onResolutionChange: (value: Sora2Resolution) => void;
	/** Whether Sora 2 Pro is selected */
	hasSora2Pro: boolean;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get price per second display string based on model and resolution
 */
function getPricePerSecond(
	hasSora2Pro: boolean,
	resolution: Sora2Resolution
): string {
	if (!hasSora2Pro) {
		return "($0.10/s)";
	}
	return resolution === "1080p" ? "($0.50/s)" : "($0.30/s)";
}

// ============================================
// Component
// ============================================

/**
 * Sora 2 settings panel component.
 *
 * @example
 * ```tsx
 * <AISora2Settings
 *   duration={4}
 *   onDurationChange={(v) => setDuration(v)}
 *   aspectRatio="16:9"
 *   onAspectRatioChange={(v) => setAspectRatio(v)}
 *   resolution="auto"
 *   onResolutionChange={(v) => setResolution(v)}
 *   hasSora2Pro={true}
 * />
 * ```
 */
export function AISora2Settings({
	duration,
	onDurationChange,
	aspectRatio,
	onAspectRatioChange,
	resolution,
	onResolutionChange,
	hasSora2Pro,
}: AISora2SettingsProps) {
	const pricePerSecond = getPricePerSecond(hasSora2Pro, resolution);

	return (
		<div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
			<Label className="text-xs font-medium">Sora 2 Settings</Label>

			{/* Duration selector */}
			<div className="space-y-1">
				<Label htmlFor="sora2-duration" className="text-xs">
					Duration
				</Label>
				<Select
					value={duration.toString()}
					onValueChange={(v) => onDurationChange(Number(v) as Sora2Duration)}
				>
					<SelectTrigger id="sora2-duration" className="h-8 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="4">4 seconds {pricePerSecond}</SelectItem>
						<SelectItem value="8">8 seconds {pricePerSecond}</SelectItem>
						<SelectItem value="12">12 seconds {pricePerSecond}</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Aspect ratio selector */}
			<div className="space-y-1">
				<Label htmlFor="sora2-aspect" className="text-xs">
					Aspect Ratio
				</Label>
				<Select
					value={aspectRatio}
					onValueChange={(v) => onAspectRatioChange(v as Sora2AspectRatio)}
				>
					<SelectTrigger id="sora2-aspect" className="h-8 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="16:9">16:9 (Landscape)</SelectItem>
						<SelectItem value="9:16">9:16 (Portrait)</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Resolution selector - only for Pro models */}
			{hasSora2Pro && (
				<div className="space-y-1">
					<Label htmlFor="sora2-resolution" className="text-xs">
						Resolution (Pro)
					</Label>
					<Select
						value={resolution}
						onValueChange={(v) => onResolutionChange(v as Sora2Resolution)}
					>
						<SelectTrigger id="sora2-resolution" className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="auto">Auto</SelectItem>
							<SelectItem value="720p">720p ($0.30/s)</SelectItem>
							<SelectItem value="1080p">1080p ($0.50/s)</SelectItem>
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	);
}
