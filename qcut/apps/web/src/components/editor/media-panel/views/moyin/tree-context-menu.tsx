/**
 * TreeContextMenu — dropdown menus for episode tree items.
 * Provides contextual actions for episodes, scenes, and shots.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	ClipboardCopyIcon,
	CopyIcon,
	MoreHorizontalIcon,
	PlusIcon,
	PencilIcon,
	SparklesIcon,
	Trash2Icon,
	ZapIcon,
} from "lucide-react";
import { useState } from "react";
import type { Shot } from "@/types/moyin-script";

/** Module-level clipboard for shot settings copy/paste */
type ShotSettings = Pick<
	Shot,
	| "shotSize"
	| "cameraMovement"
	| "specialTechnique"
	| "duration"
	| "emotionTags"
	| "lightingStyle"
	| "lightingDirection"
	| "colorTemperature"
	| "depthOfField"
	| "focusTarget"
>;
let copiedShotSettings: ShotSettings | null = null;

export function EpisodeContextMenu({
	episodeId,
	onEdit,
}: {
	episodeId: string;
	onEdit: () => void;
}) {
	const generateShotsForEpisode = useMoyinStore(
		(s) => s.generateShotsForEpisode
	);
	const removeEpisode = useMoyinStore((s) => s.removeEpisode);
	const duplicateEpisode = useMoyinStore((s) => s.duplicateEpisode);
	const addScene = useMoyinStore((s) => s.addScene);
	const episodes = useMoyinStore((s) => s.episodes);
	const shotGenerationStatus = useMoyinStore((s) => s.shotGenerationStatus);

	const isGenerating = shotGenerationStatus[episodeId] === "generating";

	const handleAddScene = () => {
		const episode = episodes.find((ep) => ep.id === episodeId);
		if (!episode) return;
		const newId = `scene_${Date.now()}`;
		addScene({
			id: newId,
			location: "New Location",
			time: "Day",
			atmosphere: "",
		});
		// Also add to episode's sceneIds
		const updatedSceneIds = [...(episode.sceneIds || []), newId];
		useMoyinStore
			.getState()
			.updateEpisode(episodeId, { sceneIds: updatedSceneIds });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
					onClick={(e) => e.stopPropagation()}
					aria-label="Episode actions"
				>
					<MoreHorizontalIcon className="h-3 w-3 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem
					onClick={() => generateShotsForEpisode(episodeId)}
					disabled={isGenerating}
				>
					<ZapIcon className="h-3.5 w-3.5" />
					<span className="text-xs">
						{isGenerating ? "Generating..." : "Generate Shots"}
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleAddScene}>
					<PlusIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Add Scene</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => duplicateEpisode(episodeId)}>
					<CopyIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Duplicate</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onEdit}>
					<PencilIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Edit</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() => {
						if (window.confirm("Delete this episode? This cannot be undone."))
							removeEpisode(episodeId);
					}}
				>
					<Trash2Icon className="h-3.5 w-3.5" />
					<span className="text-xs">Delete</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function SceneContextMenu({
	sceneId,
	onEdit,
}: {
	sceneId: string;
	onEdit: () => void;
}) {
	const enhanceScenes = useMoyinStore((s) => s.enhanceScenes);
	const removeScene = useMoyinStore((s) => s.removeScene);
	const duplicateScene = useMoyinStore((s) => s.duplicateScene);
	const shots = useMoyinStore((s) => s.shots);
	const generateShotImage = useMoyinStore((s) => s.generateShotImage);

	const sceneShots = shots.filter((s) => s.sceneRefId === sceneId);
	const pendingShots = sceneShots.filter(
		(s) => s.imageStatus !== "completed" && s.imageStatus !== "generating"
	);

	const handleGenerateScene = () => {
		for (const shot of pendingShots) {
			generateShotImage(shot.id);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
					onClick={(e) => e.stopPropagation()}
					aria-label="Scene actions"
				>
					<MoreHorizontalIcon className="h-3 w-3 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				{pendingShots.length > 0 && (
					<DropdownMenuItem onClick={handleGenerateScene}>
						<ZapIcon className="h-3.5 w-3.5" />
						<span className="text-xs">
							Generate {pendingShots.length} Shot
							{pendingShots.length > 1 ? "s" : ""}
						</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={enhanceScenes}>
					<SparklesIcon className="h-3.5 w-3.5" />
					<span className="text-xs">AI Calibrate</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => duplicateScene(sceneId)}>
					<CopyIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Duplicate</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onEdit}>
					<PencilIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Edit</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() => {
						if (window.confirm("Delete this scene? This cannot be undone."))
							removeScene(sceneId);
					}}
				>
					<Trash2Icon className="h-3.5 w-3.5" />
					<span className="text-xs">Delete</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ShotContextMenu({ shotId }: { shotId: string }) {
	const removeShot = useMoyinStore((s) => s.removeShot);
	const duplicateShot = useMoyinStore((s) => s.duplicateShot);
	const updateShot = useMoyinStore((s) => s.updateShot);
	const shots = useMoyinStore((s) => s.shots);
	const scenes = useMoyinStore((s) => s.scenes);
	const characters = useMoyinStore((s) => s.characters);
	const [copied, setCopied] = useState(false);
	const [settingsCopied, setSettingsCopied] = useState(false);

	const handleCopyShot = async () => {
		const shot = shots.find((s) => s.id === shotId);
		if (!shot) return;
		const scene = scenes.find((s) => s.id === shot.sceneRefId);
		const charNames = (shot.characterIds || [])
			.map((cid) => characters.find((c) => c.id === cid)?.name)
			.filter(Boolean);
		const lines = [
			`Shot #${shot.index + 1}${shot.shotSize ? ` (${shot.shotSize})` : ""}`,
			scene ? `Scene: ${scene.name || scene.location}` : "",
			shot.actionSummary ? `Action: ${shot.actionSummary}` : "",
			shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
			shot.cameraMovement ? `Camera: ${shot.cameraMovement}` : "",
			charNames.length > 0 ? `Characters: ${charNames.join(", ")}` : "",
			shot.emotionTags?.length ? `Emotion: ${shot.emotionTags.join(", ")}` : "",
			shot.ambientSound ? `Ambient: ${shot.ambientSound}` : "",
		].filter(Boolean);
		await navigator.clipboard.writeText(lines.join("\n"));
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleCopySettings = () => {
		const shot = shots.find((s) => s.id === shotId);
		if (!shot) return;
		copiedShotSettings = {
			shotSize: shot.shotSize,
			cameraMovement: shot.cameraMovement,
			specialTechnique: shot.specialTechnique,
			duration: shot.duration,
			emotionTags: shot.emotionTags,
			lightingStyle: shot.lightingStyle,
			lightingDirection: shot.lightingDirection,
			colorTemperature: shot.colorTemperature,
			depthOfField: shot.depthOfField,
			focusTarget: shot.focusTarget,
		};
		setSettingsCopied(true);
		setTimeout(() => setSettingsCopied(false), 1500);
	};

	const handlePasteSettings = () => {
		if (!copiedShotSettings) return;
		const cleaned: Partial<Shot> = {};
		for (const [k, v] of Object.entries(copiedShotSettings)) {
			if (v !== undefined) (cleaned as Record<string, unknown>)[k] = v;
		}
		updateShot(shotId, cleaned);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
					onClick={(e) => e.stopPropagation()}
					aria-label="Shot actions"
				>
					<MoreHorizontalIcon className="h-3 w-3 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-40">
				<DropdownMenuItem onClick={handleCopyShot}>
					<ClipboardCopyIcon className="h-3.5 w-3.5" />
					<span className="text-xs" aria-live="polite">
						{copied ? "Copied!" : "Copy Shot"}
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleCopySettings}>
					<CopyIcon className="h-3.5 w-3.5" />
					<span className="text-xs" aria-live="polite">
						{settingsCopied ? "Copied!" : "Copy Settings"}
					</span>
				</DropdownMenuItem>
				{copiedShotSettings && (
					<DropdownMenuItem onClick={handlePasteSettings}>
						<ClipboardCopyIcon className="h-3.5 w-3.5" />
						<span className="text-xs">Paste Settings</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={() => duplicateShot(shotId)}>
					<CopyIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Duplicate</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() => {
						if (window.confirm("Delete this shot? This cannot be undone."))
							removeShot(shotId);
					}}
				>
					<Trash2Icon className="h-3.5 w-3.5" />
					<span className="text-xs">Delete</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
