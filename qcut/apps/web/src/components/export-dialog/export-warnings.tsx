import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoryEstimate } from "@/lib/ffmpeg/memory-utils";

// ---------------------------------------------------------------------------
// Prop interfaces
// ---------------------------------------------------------------------------

export interface ExportWarningsProps {
	/** Memory warning message (null/empty when no warning) */
	memoryWarning: string;
	/** Full memory estimate object for styling decisions */
	memoryEstimate: MemoryEstimate;
	/** Whether the timeline has any content to export */
	hasTimelineContent: boolean;
	/** Whether the video is very short */
	isShortVideo: boolean;
	/** Timeline duration in seconds (for short-video message) */
	timelineDuration: number;
	/** Error from export store (null when none) */
	error: string | null;
}

// ---------------------------------------------------------------------------
// ExportWarnings
// ---------------------------------------------------------------------------

export function ExportWarnings({
	memoryWarning,
	memoryEstimate,
	hasTimelineContent,
	isShortVideo,
	timelineDuration,
	error,
}: ExportWarningsProps) {
	const isSevere =
		memoryEstimate.warningLevel === "maximum" ||
		memoryEstimate.warningLevel === "critical";

	return (
		<>
			{/* Memory Warning */}
			{memoryWarning && (
				<Alert
					className={cn(
						"border-yellow-500 bg-yellow-50",
						isSevere
							? "border-red-500 bg-red-50"
							: "border-yellow-500 bg-yellow-50"
					)}
				>
					<AlertTriangle
						className={cn(
							"h-4 w-4",
							isSevere ? "text-red-600" : "text-yellow-600"
						)}
					/>
					<AlertDescription
						className={cn(isSevere ? "text-red-800" : "text-yellow-800")}
					>
						<div className="font-medium">
							{memoryEstimate.warningLevel === "maximum"
								? "Export Blocked"
								: memoryEstimate.warningLevel === "critical"
									? "High Memory Usage"
									: "Memory Warning"}
						</div>
						<div>{memoryWarning}</div>
						{memoryEstimate.recommendation && (
							<div className="mt-1 text-sm">
								<strong>Recommendation:</strong> Switch to{" "}
								{memoryEstimate.recommendation.suggestedQuality} quality (
								{memoryEstimate.recommendation.description})
							</div>
						)}
					</AlertDescription>
				</Alert>
			)}

			{/* Timeline Warnings */}
			{!hasTimelineContent && (
				<Alert className="border-red-500 bg-red-50">
					<AlertTriangle className="h-4 w-4 text-red-600" />
					<AlertDescription className="text-red-800">
						<div className="font-medium">No Content</div>
						<div>
							Your timeline is empty. Add some media files to export a video.
						</div>
					</AlertDescription>
				</Alert>
			)}

			{isShortVideo && (
				<Alert className="border-yellow-500 bg-yellow-50">
					<AlertTriangle className="h-4 w-4 text-yellow-600" />
					<AlertDescription className="text-yellow-800">
						<div className="font-medium">Very Short Video</div>
						<div>
							Your timeline is very short ({timelineDuration.toFixed(2)}s).
							Consider adding more content for a better export result.
						</div>
					</AlertDescription>
				</Alert>
			)}

			{/* Error Display */}
			{error && (
				<Alert className="border-red-500 bg-red-50">
					<AlertTriangle className="h-4 w-4 text-red-600" />
					<AlertDescription className="text-red-800">{error}</AlertDescription>
				</Alert>
			)}
		</>
	);
}
