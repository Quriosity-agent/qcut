/**
 * GenerateActions — step 4: configure style/profile and trigger storyboard generation.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	ArrowLeftIcon,
	CheckCircle2Icon,
	Loader2,
	RotateCcwIcon,
	SparklesIcon,
} from "lucide-react";
import { VISUAL_STYLE_PRESETS } from "@/lib/moyin/presets/visual-styles";
import { CINEMATOGRAPHY_PROFILES } from "@/lib/moyin/presets/cinematography-profiles";
import { useMemo } from "react";

/** Group style presets by category for the select dropdown */
function useGroupedStyles() {
	return useMemo(() => {
		const groups: Record<string, typeof VISUAL_STYLE_PRESETS> = {};
		for (const preset of VISUAL_STYLE_PRESETS) {
			const cat = preset.category;
			if (!groups[cat]) groups[cat] = [];
			(groups[cat] as (typeof VISUAL_STYLE_PRESETS)[number][]).push(preset);
		}
		return groups;
	}, []);
}

const CATEGORY_LABELS: Record<string, string> = {
	"3d": "3D Styles",
	"2d": "2D / Anime",
	real: "Realistic / Film",
	stop_motion: "Stop Motion",
};

export function GenerateActions() {
	const scenes = useMoyinStore((s) => s.scenes);
	const characters = useMoyinStore((s) => s.characters);
	const selectedStyleId = useMoyinStore((s) => s.selectedStyleId);
	const selectedProfileId = useMoyinStore((s) => s.selectedProfileId);
	const setSelectedStyleId = useMoyinStore((s) => s.setSelectedStyleId);
	const setSelectedProfileId = useMoyinStore((s) => s.setSelectedProfileId);
	const generationStatus = useMoyinStore((s) => s.generationStatus);
	const generationProgress = useMoyinStore((s) => s.generationProgress);
	const generationError = useMoyinStore((s) => s.generationError);
	const generateStoryboard = useMoyinStore((s) => s.generateStoryboard);
	const setActiveStep = useMoyinStore((s) => s.setActiveStep);
	const reset = useMoyinStore((s) => s.reset);

	const groupedStyles = useGroupedStyles();

	const storyboardImageUrl = useMoyinStore((s) => s.storyboardImageUrl);
	const storyboardGridConfig = useMoyinStore((s) => s.storyboardGridConfig);

	const isGenerating = generationStatus === "generating";
	const isDone = generationStatus === "done";

	const selectedStyle = VISUAL_STYLE_PRESETS.find(
		(s) => s.id === selectedStyleId
	);
	const selectedProfile = CINEMATOGRAPHY_PROFILES.find(
		(p) => p.id === selectedProfileId
	);

	return (
		<div className="space-y-4">
			{/* Style Selector */}
			<div className="space-y-1.5">
				<Label className="text-xs">Visual Style</Label>
				<Select
					value={selectedStyleId}
					onValueChange={setSelectedStyleId}
					disabled={isGenerating}
				>
					<SelectTrigger className="h-8 text-xs">
						<SelectValue placeholder="Select style" />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(groupedStyles).map(([category, presets]) => (
							<SelectGroup key={category}>
								<SelectLabel className="text-[10px] uppercase tracking-wider">
									{CATEGORY_LABELS[category] || category}
								</SelectLabel>
								{(presets as (typeof VISUAL_STYLE_PRESETS)[number][]).map(
									(preset) => (
										<SelectItem
											key={preset.id}
											value={preset.id}
											className="text-xs"
										>
											{preset.name}
										</SelectItem>
									)
								)}
							</SelectGroup>
						))}
					</SelectContent>
				</Select>
				{selectedStyle && (
					<p className="text-[10px] text-muted-foreground line-clamp-1">
						{selectedStyle.description}
					</p>
				)}
			</div>

			{/* Profile Selector */}
			<div className="space-y-1.5">
				<Label className="text-xs">Camera Profile</Label>
				<Select
					value={selectedProfileId}
					onValueChange={setSelectedProfileId}
					disabled={isGenerating}
				>
					<SelectTrigger className="h-8 text-xs">
						<SelectValue placeholder="Select profile" />
					</SelectTrigger>
					<SelectContent>
						{CINEMATOGRAPHY_PROFILES.map((profile) => (
							<SelectItem
								key={profile.id}
								value={profile.id}
								className="text-xs"
							>
								{profile.emoji} {profile.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{selectedProfile && (
					<p className="text-[10px] text-muted-foreground line-clamp-1">
						{selectedProfile.referenceFilms.slice(0, 3).join(", ")}
					</p>
				)}
			</div>

			{/* Summary */}
			<div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
				<p className="text-xs font-medium">Storyboard Summary</p>
				<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
					<span>Characters: {characters.length}</span>
					<span>Scenes: {scenes.length}</span>
					<span>Style: {selectedStyle?.name || selectedStyleId}</span>
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
				<div className="space-y-2">
					<div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
						<CheckCircle2Icon className="h-4 w-4" />
						Storyboard generated
						{storyboardGridConfig &&
							` (${storyboardGridConfig.cols}x${storyboardGridConfig.rows} grid)`}
					</div>
					{storyboardImageUrl && (
						<div className="rounded-md border overflow-hidden">
							<img
								src={storyboardImageUrl}
								alt="Generated storyboard"
								className="w-full h-auto"
							/>
						</div>
					)}
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
