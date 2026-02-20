/**
 * Remotion Export Progress Component
 *
 * Displays detailed progress for Remotion element pre-rendering
 * during video export.
 *
 * @module components/export/remotion-export-progress
 */

"use client";

import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	SkipForward,
	ChevronDown,
	ChevronRight,
	Film,
	Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
	useExportStore,
	type RemotionElementProgress,
} from "@/stores/export-store";

// ============================================================================
// Types
// ============================================================================

export interface RemotionExportProgressProps {
	/** Whether to show the expanded element list by default */
	defaultExpanded?: boolean;
	/** Whether to allow skipping failed elements */
	allowSkipFailed?: boolean;
	/** Custom class name */
	className?: string;
}

// ============================================================================
// Sub-components
// ============================================================================

interface ElementProgressItemProps {
	element: RemotionElementProgress;
	onSkip?: () => void;
	allowSkip?: boolean;
}

function ElementProgressItem({
	element,
	onSkip,
	allowSkip,
}: ElementProgressItemProps) {
	const statusIcon = {
		pending: <Clock className="h-3 w-3 text-muted-foreground" />,
		rendering: <Loader2 className="h-3 w-3 text-primary animate-spin" />,
		complete: <CheckCircle2 className="h-3 w-3 text-green-500" />,
		error: <XCircle className="h-3 w-3 text-destructive" />,
		skipped: <SkipForward className="h-3 w-3 text-yellow-500" />,
	};

	return (
		<div
			className={cn(
				"flex items-center gap-2 py-1.5 px-2 rounded-sm",
				element.status === "rendering" && "bg-primary/5",
				element.status === "error" && "bg-destructive/5"
			)}
		>
			{statusIcon[element.status]}
			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs font-medium truncate">
						{element.elementName}
					</span>
					<span className="text-[10px] text-muted-foreground whitespace-nowrap">
						{element.status === "rendering"
							? `${element.framesCompleted}/${element.totalFrames}`
							: element.status === "complete"
								? `${element.totalFrames} frames`
								: element.status}
					</span>
				</div>
				{element.status === "rendering" && (
					<Progress value={element.progress} className="h-1 mt-1" />
				)}
				{element.status === "error" && element.error && (
					<div className="flex items-center justify-between mt-1">
						<span className="text-[10px] text-destructive truncate">
							{element.error}
						</span>
						{allowSkip && onSkip && (
							<Button
								type="button"
								variant="text"
								size="sm"
								onClick={onSkip}
								className="h-5 px-2 text-[10px]"
							>
								<SkipForward className="h-2.5 w-2.5 mr-1" />
								Skip
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Phase Indicator
// ============================================================================

interface PhaseIndicatorProps {
	phase: string;
	isActive: boolean;
	isComplete: boolean;
}

function PhaseIndicator({ phase, isActive, isComplete }: PhaseIndicatorProps) {
	const phaseLabels: Record<string, string> = {
		analyzing: "Analyze",
		prerendering: "Pre-render",
		compositing: "Composite",
		encoding: "Encode",
		cleanup: "Cleanup",
	};

	return (
		<div
			className={cn(
				"flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
				isActive && "bg-primary/10 text-primary",
				isComplete && "bg-green-500/10 text-green-600",
				!isActive && !isComplete && "bg-muted text-muted-foreground"
			)}
		>
			{isActive && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
			{isComplete && <CheckCircle2 className="h-2.5 w-2.5" />}
			<span>{phaseLabels[phase] ?? phase}</span>
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function RemotionExportProgress({
	defaultExpanded = false,
	allowSkipFailed = true,
	className,
}: RemotionExportProgressProps) {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded);
	const remotionProgress = useExportStore((state) => state.remotionProgress);
	const skipFailedElement = useExportStore(
		(state) => state.skipFailedRemotionElement
	);

	// Don't render if there are no Remotion elements
	if (!remotionProgress.hasRemotionElements) {
		return null;
	}

	// Don't render if in idle phase
	if (remotionProgress.phase === "idle") {
		return null;
	}

	const phases = [
		"analyzing",
		"prerendering",
		"compositing",
		"encoding",
		"cleanup",
	];
	const currentPhaseIndex =
		remotionProgress.phase === "complete" || remotionProgress.phase === "error"
			? phases.length
			: phases.indexOf(remotionProgress.phase);

	const hasErrors = remotionProgress.elementProgress.some(
		(ep) => ep.status === "error"
	);
	const renderingElement = remotionProgress.elementProgress.find(
		(ep) => ep.status === "rendering"
	);

	return (
		<div
			className={cn(
				"space-y-3 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg",
				className
			)}
		>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Film className="h-4 w-4 text-violet-500" />
					<span className="text-sm font-medium">Remotion Export</span>
				</div>
				<span className="text-xs text-muted-foreground">
					{remotionProgress.overallProgress.toFixed(0)}%
				</span>
			</div>

			{/* Overall Progress */}
			<Progress value={remotionProgress.overallProgress} className="h-2" />

			{/* Phase Indicators */}
			<div className="flex flex-wrap gap-1">
				{phases.map((phase, index) => (
					<PhaseIndicator
						key={phase}
						phase={phase}
						isActive={phase === remotionProgress.phase}
						isComplete={index < currentPhaseIndex}
					/>
				))}
			</div>

			{/* Status Message */}
			<p className="text-xs text-muted-foreground">
				{remotionProgress.statusMessage}
			</p>

			{/* Currently Rendering Element */}
			{renderingElement && (
				<div className="text-xs">
					<span className="text-muted-foreground">Rendering: </span>
					<span className="font-medium">{renderingElement.elementName}</span>
					<span className="text-muted-foreground ml-2">
						({renderingElement.framesCompleted}/{renderingElement.totalFrames}{" "}
						frames)
					</span>
				</div>
			)}

			{/* Error Alert */}
			{hasErrors && (
				<Alert variant="destructive" className="py-2">
					<AlertDescription className="text-xs">
						Some Remotion elements failed to render. You can skip them to
						continue export.
					</AlertDescription>
				</Alert>
			)}

			{/* Element List (Collapsible) */}
			{remotionProgress.elementProgress.length > 0 && (
				<Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
					<CollapsibleTrigger asChild>
						<Button
							type="button"
							variant="text"
							size="sm"
							className="w-full justify-between h-7 px-2"
						>
							<div className="flex items-center gap-1.5">
								<Layers className="h-3 w-3" />
								<span className="text-xs">
									Elements ({remotionProgress.elementsCompleted}/
									{remotionProgress.elementsTotal})
								</span>
							</div>
							{isExpanded ? (
								<ChevronDown className="h-3 w-3" />
							) : (
								<ChevronRight className="h-3 w-3" />
							)}
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent className="pt-2">
						<div className="space-y-1 max-h-40 overflow-auto">
							{remotionProgress.elementProgress.map((element) => (
								<ElementProgressItem
									key={element.elementId}
									element={element}
									allowSkip={allowSkipFailed}
									onSkip={() => skipFailedElement(element.elementId)}
								/>
							))}
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}

			{/* Time Remaining */}
			{remotionProgress.estimatedTimeRemaining !== undefined &&
				remotionProgress.estimatedTimeRemaining > 0 && (
					<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<Clock className="h-3 w-3" />
						<span>
							~{Math.ceil(remotionProgress.estimatedTimeRemaining)}s remaining
						</span>
					</div>
				)}
		</div>
	);
}

export default RemotionExportProgress;
