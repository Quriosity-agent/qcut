/**
 * GenerateActions — step 4: trigger storyboard generation.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
	ArrowLeftIcon,
	CheckCircle2Icon,
	Loader2,
	RotateCcwIcon,
	SparklesIcon,
} from "lucide-react";

export function GenerateActions() {
	const scenes = useMoyinStore((s) => s.scenes);
	const characters = useMoyinStore((s) => s.characters);
	const selectedStyleId = useMoyinStore((s) => s.selectedStyleId);
	const generationStatus = useMoyinStore((s) => s.generationStatus);
	const generationProgress = useMoyinStore((s) => s.generationProgress);
	const generationError = useMoyinStore((s) => s.generationError);
	const generateStoryboard = useMoyinStore((s) => s.generateStoryboard);
	const setActiveStep = useMoyinStore((s) => s.setActiveStep);
	const reset = useMoyinStore((s) => s.reset);

	const isGenerating = generationStatus === "generating";
	const isDone = generationStatus === "done";

	return (
		<div className="space-y-4">
			{/* Summary */}
			<div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
				<p className="text-xs font-medium">Storyboard Summary</p>
				<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
					<span>Characters: {characters.length}</span>
					<span>Scenes: {scenes.length}</span>
					<span>Style: {selectedStyleId}</span>
					<span>Status: {generationStatus}</span>
				</div>
			</div>

			{/* Progress */}
			{isGenerating && (
				<div className="space-y-2">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
						Generating storyboard...
					</div>
					<Progress value={generationProgress} />
				</div>
			)}

			{/* Error */}
			{generationError && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
					{generationError}
				</div>
			)}

			{/* Done */}
			{isDone && (
				<div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
					<CheckCircle2Icon className="h-4 w-4" />
					Storyboard generated successfully
				</div>
			)}

			{/* Actions */}
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setActiveStep("scenes")}
					disabled={isGenerating}
				>
					<ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />
					Scenes
				</Button>

				{isDone ? (
					<Button size="sm" className="flex-1" onClick={reset}>
						<RotateCcwIcon className="mr-1.5 h-3.5 w-3.5" />
						New Script
					</Button>
				) : (
					<Button
						size="sm"
						className="flex-1"
						onClick={generateStoryboard}
						disabled={isGenerating || scenes.length === 0}
					>
						{isGenerating ? (
							<>
								<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								Generating...
							</>
						) : (
							<>
								<SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
								Generate Storyboard
							</>
						)}
					</Button>
				)}
			</div>
		</div>
	);
}
