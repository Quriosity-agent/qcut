/**
 * GenerateActions — generation controls: summary, progress, result display.
 * Style/profile selectors are now in ScriptInput panel.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import {
	exportProjectJSON,
	parseImportedProjectJSON,
	partializeMoyinState,
} from "@/stores/moyin-persistence";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCallback, useRef, useState } from "react";
import {
	CheckCircle2Icon,
	CopyIcon,
	DownloadIcon,
	GridIcon,
	Loader2,
	RotateCcwIcon,
	SparklesIcon,
	UploadIcon,
} from "lucide-react";
import { VISUAL_STYLE_PRESETS } from "@/lib/moyin/presets/visual-styles";
import {
	BatchGenerateButtons,
	BatchProgressOverlay,
	useBatchGeneration,
} from "./batch-progress";

export function GenerateActions() {
	const scenes = useMoyinStore((s) => s.scenes);
	const characters = useMoyinStore((s) => s.characters);
	const selectedStyleId = useMoyinStore((s) => s.selectedStyleId);
	const generationStatus = useMoyinStore((s) => s.generationStatus);
	const generationProgress = useMoyinStore((s) => s.generationProgress);
	const generationError = useMoyinStore((s) => s.generationError);
	const generateStoryboard = useMoyinStore((s) => s.generateStoryboard);
	const reset = useMoyinStore((s) => s.reset);
	const storyboardImageUrl = useMoyinStore((s) => s.storyboardImageUrl);
	const storyboardGridConfig = useMoyinStore((s) => s.storyboardGridConfig);

	const shots = useMoyinStore((s) => s.shots);
	const splitAndApplyStoryboard = useMoyinStore(
		(s) => s.splitAndApplyStoryboard
	);

	const [isSplitting, setIsSplitting] = useState(false);
	const [exportCopied, setExportCopied] = useState(false);
	const episodes = useMoyinStore((s) => s.episodes);
	const scriptData = useMoyinStore((s) => s.scriptData);

	const { batch, startBatch, cancel } = useBatchGeneration();
	const isGenerating = generationStatus === "generating";
	const isDone = generationStatus === "done";

	const handleSplit = async () => {
		setIsSplitting(true);
		try {
			await splitAndApplyStoryboard();
		} finally {
			setIsSplitting(false);
		}
	};

	const selectedStyle = VISUAL_STYLE_PRESETS.find(
		(s) => s.id === selectedStyleId
	);

	const imagesDone = shots.filter((s) => s.imageStatus === "completed").length;
	const videosDone = shots.filter((s) => s.videoStatus === "completed").length;

	const handleExport = async () => {
		const title = scriptData?.title || "Untitled Project";
		const lines: string[] = [`# ${title}`, ""];

		if (characters.length > 0) {
			lines.push("## Characters", "");
			for (const c of characters) {
				lines.push(`- **${c.name}**${c.role ? ` — ${c.role}` : ""}`);
			}
			lines.push("");
		}

		for (const ep of episodes) {
			lines.push(`## ${ep.title}`, "");
			const epScenes = scenes.filter((s) => ep.sceneIds.includes(s.id));
			for (const scene of epScenes) {
				lines.push(
					`### ${scene.name || scene.location}${scene.time ? ` (${scene.time})` : ""}`,
					""
				);
				const sceneShots = shots.filter((s) => s.sceneRefId === scene.id);
				for (const shot of sceneShots) {
					const status = shot.imageStatus === "completed" ? "[img]" : "[   ]";
					const video = shot.videoStatus === "completed" ? "[vid]" : "[   ]";
					lines.push(
						`- ${status}${video} **${shot.shotSize || "—"}** ${shot.actionSummary || "—"}${shot.cameraMovement ? ` (${shot.cameraMovement})` : ""}`
					);
				}
				lines.push("");
			}
		}

		if (episodes.length === 0 && scenes.length > 0) {
			lines.push("## Scenes", "");
			for (const scene of scenes) {
				lines.push(
					`### ${scene.name || scene.location}${scene.time ? ` (${scene.time})` : ""}`,
					""
				);
				const sceneShots = shots.filter((s) => s.sceneRefId === scene.id);
				for (const shot of sceneShots) {
					const status = shot.imageStatus === "completed" ? "[img]" : "[   ]";
					const video = shot.videoStatus === "completed" ? "[vid]" : "[   ]";
					lines.push(
						`- ${status}${video} **${shot.shotSize || "—"}** ${shot.actionSummary || "—"}`
					);
				}
				lines.push("");
			}
		}

		lines.push(
			`---`,
			`Images: ${imagesDone}/${shots.length} | Videos: ${videosDone}/${shots.length}`,
			`Style: ${selectedStyle?.name || selectedStyleId}`
		);

		await navigator.clipboard.writeText(lines.join("\n"));
		setExportCopied(true);
		setTimeout(() => setExportCopied(false), 1500);
	};

	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleExportJSON = useCallback(() => {
		const state = useMoyinStore.getState();
		exportProjectJSON(partializeMoyinState(state), scriptData?.title);
	}, [scriptData?.title]);

	const handleImportJSON = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				const result = parseImportedProjectJSON(reader.result as string);
				if (result) {
					useMoyinStore.setState({
						...result,
						parseStatus: result.parseStatus || "ready",
					});
				}
			};
			reader.readAsText(file);
			if (fileInputRef.current) fileInputRef.current.value = "";
		},
		[]
	);

	return (
		<div className="space-y-3">
			{/* Batch overlay */}
			{batch && <BatchProgressOverlay batch={batch} onCancel={cancel} />}

			{/* Summary */}
			<div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
				<p className="text-xs font-medium">Storyboard Summary</p>
				<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
					<span>Characters: {characters.length}</span>
					<span>Scenes: {scenes.length}</span>
					<span>Style: {selectedStyle?.name || selectedStyleId}</span>
					<span>Status: {generationStatus}</span>
				</div>
				{shots.length > 0 && (
					<div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-dashed">
						<span
							className={
								imagesDone === shots.length
									? "text-green-600"
									: imagesDone > 0
										? "text-amber-600"
										: "text-muted-foreground"
							}
						>
							Images: {imagesDone}/{shots.length}
						</span>
						<span
							className={
								videosDone === shots.length
									? "text-green-600"
									: videosDone > 0
										? "text-amber-600"
										: "text-muted-foreground"
							}
						>
							Videos: {videosDone}/{shots.length}
						</span>
					</div>
				)}
				{shots.length > 0 && (imagesDone > 0 || videosDone > 0) && (
					<div className="space-y-1 pt-1">
						<div className="flex items-center gap-1.5">
							<span className="text-[9px] text-muted-foreground w-6">Img</span>
							<Progress
								value={shots.length > 0 ? (imagesDone / shots.length) * 100 : 0}
								className="flex-1 h-1.5"
								aria-label={`Images: ${imagesDone} of ${shots.length}`}
							/>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="text-[9px] text-muted-foreground w-6">Vid</span>
							<Progress
								value={shots.length > 0 ? (videosDone / shots.length) * 100 : 0}
								className="flex-1 h-1.5"
								aria-label={`Videos: ${videosDone} of ${shots.length}`}
							/>
						</div>
					</div>
				)}
			</div>

			{/* Progress */}
			{isGenerating && (
				<div className="space-y-2">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
						Generating storyboard...
					</div>
					<Progress
						value={generationProgress}
						aria-label="Storyboard generation progress"
					/>
				</div>
			)}

			{/* Error */}
			{generationError && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-2">
					<span className="flex-1">{generationError}</span>
					<button
						type="button"
						onClick={generateStoryboard}
						className="shrink-0 underline hover:no-underline"
						disabled={isGenerating}
					>
						Retry
					</button>
				</div>
			)}

			{/* Done */}
			{isDone && (
				<div className="space-y-2">
					<div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-700 dark:text-green-400">
						<CheckCircle2Icon className="h-3.5 w-3.5" />
						Storyboard generated
						{storyboardGridConfig &&
							` (${storyboardGridConfig.cols}x${storyboardGridConfig.rows} grid)`}
					</div>
					{storyboardImageUrl && (
						<>
							<div className="rounded-md border overflow-hidden">
								<img
									src={storyboardImageUrl}
									alt="Generated storyboard"
									className="w-full h-auto"
								/>
							</div>
							{shots.length > 0 && (
								<Button
									size="sm"
									variant="outline"
									className="w-full"
									onClick={handleSplit}
									disabled={isSplitting}
								>
									{isSplitting ? (
										<>
											<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
											Splitting...
										</>
									) : (
										<>
											<GridIcon className="mr-1.5 h-3.5 w-3.5" />
											Split & Apply to Shots
										</>
									)}
								</Button>
							)}
						</>
					)}
				</div>
			)}

			{/* Batch shot generation */}
			<BatchGenerateButtons
				onStart={startBatch}
				disabled={isGenerating || !!batch}
			/>

			{/* JSON Export/Import */}
			<div className="flex gap-1.5">
				<Button
					size="sm"
					variant="outline"
					className="flex-1"
					onClick={handleExportJSON}
				>
					<DownloadIcon className="mr-1 h-3.5 w-3.5" />
					Export JSON
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="flex-1"
					onClick={() => fileInputRef.current?.click()}
				>
					<UploadIcon className="mr-1 h-3.5 w-3.5" />
					Import JSON
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".json"
					className="hidden"
					aria-label="Import project JSON file"
					onChange={handleImportJSON}
				/>
			</div>

			{/* Action buttons */}
			{isDone ? (
				<div className="flex gap-1.5">
					<Button size="sm" className="flex-1" onClick={reset}>
						<RotateCcwIcon className="mr-1.5 h-3.5 w-3.5" />
						New Script
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={handleExport}
						disabled={shots.length === 0}
					>
						<CopyIcon className="mr-1.5 h-3.5 w-3.5" />
						{exportCopied ? "Copied!" : "Export"}
					</Button>
				</div>
			) : (
				<Button
					size="sm"
					className="w-full"
					onClick={generateStoryboard}
					disabled={isGenerating || scenes.length === 0}
					title={
						scenes.length === 0
							? "Add scenes first to generate storyboard"
							: undefined
					}
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
	);
}
