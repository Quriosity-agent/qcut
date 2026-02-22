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
	CopyIcon,
	MoreHorizontalIcon,
	PlusIcon,
	PencilIcon,
	SparklesIcon,
	Trash2Icon,
	ZapIcon,
} from "lucide-react";

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
					onClick={() => removeEpisode(episodeId)}
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
			<DropdownMenuContent align="end" className="w-40">
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
					onClick={() => removeScene(sceneId)}
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
			<DropdownMenuContent align="end" className="w-36">
				<DropdownMenuItem onClick={() => duplicateShot(shotId)}>
					<CopyIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Duplicate</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() => removeShot(shotId)}
				>
					<Trash2Icon className="h-3.5 w-3.5" />
					<span className="text-xs">Delete</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
