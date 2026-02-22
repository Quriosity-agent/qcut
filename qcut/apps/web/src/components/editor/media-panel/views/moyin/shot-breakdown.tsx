/**
 * ShotBreakdown — visual shot list grouped by scene with sticky headers.
 * Compact layout for scanning many shots at a glance.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	CameraIcon,
	ClipboardCopyIcon,
	CopyIcon,
	FileTextIcon,
	FilterIcon,
	GridIcon,
	ImageIcon,
	ListIcon,
	MapPinIcon,
	MessageSquareIcon,
	PlusIcon,
	SearchIcon,
	SparklesIcon,
	Trash2Icon,
	UserIcon,
} from "lucide-react";

function ShotStatusDot({ status, label }: { status: string; label?: string }) {
	const statusLabel =
		status === "completed"
			? "Completed"
			: status === "generating"
				? "Generating"
				: status === "failed"
					? "Failed"
					: "Pending";
	return (
		<span
			className={cn(
				"inline-block h-1.5 w-1.5 rounded-full shrink-0",
				status === "completed"
					? "bg-green-500"
					: status === "generating"
						? "bg-yellow-500 animate-pulse"
						: status === "failed"
							? "bg-red-500"
							: "bg-muted-foreground/30"
			)}
			title={label ? `${label}: ${statusLabel}` : statusLabel}
			aria-label={label ? `${label}: ${statusLabel}` : statusLabel}
		/>
	);
}

const NARRATIVE_BADGE: Record<string, { label: string; cls: string }> = {
	exposition: {
		label: "EX",
		cls: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
	},
	escalation: {
		label: "ES",
		cls: "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200",
	},
	climax: {
		label: "CL",
		cls: "bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200",
	},
	"turning-point": {
		label: "TP",
		cls: "bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
	},
	transition: {
		label: "TR",
		cls: "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
	},
	denouement: {
		label: "DN",
		cls: "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200",
	},
};

export function ShotBreakdown() {
	const scenes = useMoyinStore((s) => s.scenes);
	const shots = useMoyinStore((s) => s.shots);
	const addShot = useMoyinStore((s) => s.addShot);
	const selectedItemId = useMoyinStore((s) => s.selectedItemId);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);
	const reorderShots = useMoyinStore((s) => s.reorderShots);
	const selectedShotIds = useMoyinStore((s) => s.selectedShotIds);
	const toggleShotSelection = useMoyinStore((s) => s.toggleShotSelection);
	const clearShotSelection = useMoyinStore((s) => s.clearShotSelection);
	const deleteSelectedShots = useMoyinStore((s) => s.deleteSelectedShots);
	const duplicateShot = useMoyinStore((s) => s.duplicateShot);
	const generateShotImage = useMoyinStore((s) => s.generateShotImage);
	const [viewMode, setViewMode] = useState<"list" | "grid">("list");
	const [filter, setFilter] = useState<
		"all" | "has-image" | "has-video" | "incomplete"
	>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [dragOverId, setDragOverId] = useState<string | null>(null);
	const dragShotIdRef = useRef<string | null>(null);

	const handleAddShot = useCallback(
		(sceneId: string) => {
			const sceneShots = shots.filter((s) => s.sceneRefId === sceneId);
			const newShot = {
				id: `shot_${Date.now()}`,
				index: shots.length,
				sceneRefId: sceneId,
				actionSummary: `Shot ${sceneShots.length + 1}`,
				characterIds: [],
				characterVariations: {},
				imageStatus: "idle" as const,
				imageProgress: 0,
				videoStatus: "idle" as const,
				videoProgress: 0,
			};
			addShot(newShot);
			setSelectedItem(newShot.id, "shot");
		},
		[shots, addShot, setSelectedItem]
	);

	const handleShotClick = useCallback(
		(shotId: string, e: React.MouseEvent) => {
			if (e.shiftKey) {
				toggleShotSelection(shotId);
			} else {
				clearShotSelection();
				setSelectedItem(shotId, "shot");
			}
		},
		[toggleShotSelection, clearShotSelection, setSelectedItem]
	);

	const handleDragStart = useCallback((shotId: string, e: React.DragEvent) => {
		dragShotIdRef.current = shotId;
		e.dataTransfer.effectAllowed = "move";
	}, []);

	const handleDragOver = useCallback((shotId: string, e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		setDragOverId(shotId);
	}, []);

	const handleDrop = useCallback(
		(targetShotId: string, sceneShots: { id: string }[]) => {
			const fromId = dragShotIdRef.current;
			if (!fromId || fromId === targetShotId) {
				setDragOverId(null);
				return;
			}
			const targetIdx = sceneShots.findIndex((s) => s.id === targetShotId);
			reorderShots(fromId, targetIdx);
			setDragOverId(null);
			dragShotIdRef.current = null;
		},
		[reorderShots]
	);

	const handleDragEnd = useCallback(() => {
		setDragOverId(null);
		dragShotIdRef.current = null;
	}, []);

	const handleDuplicateSelected = useCallback(() => {
		for (const id of selectedShotIds) {
			duplicateShot(id);
		}
		clearShotSelection();
	}, [selectedShotIds, duplicateShot, clearShotSelection]);

	const handleBulkCopyPrompts = useCallback(() => {
		const selected = shots.filter((s) => selectedShotIds.has(s.id));
		const lines = selected.map(
			(s) =>
				`Shot ${s.index + 1}: ${s.imagePrompt || s.visualPrompt || s.actionSummary || "—"}`
		);
		navigator.clipboard.writeText(lines.join("\n"));
	}, [shots, selectedShotIds]);

	const handleBulkGenerate = useCallback(() => {
		const pending = shots.filter(
			(s) =>
				selectedShotIds.has(s.id) &&
				(s.imageStatus === "idle" || s.imageStatus === "failed")
		);
		for (const s of pending) {
			generateShotImage(s.id);
		}
		clearShotSelection();
	}, [shots, selectedShotIds, generateShotImage, clearShotSelection]);

	const filteredShots = useMemo(() => {
		let result = shots;
		if (filter === "has-image")
			result = result.filter((s) => s.imageStatus === "completed");
		else if (filter === "has-video")
			result = result.filter((s) => s.videoStatus === "completed");
		else if (filter === "incomplete")
			result = result.filter(
				(s) => s.imageStatus !== "completed" || s.videoStatus !== "completed"
			);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(s) =>
					(s.actionSummary || "").toLowerCase().includes(q) ||
					(s.dialogue || "").toLowerCase().includes(q) ||
					(s.characterNames || []).some((n) => n.toLowerCase().includes(q))
			);
		}
		return result;
	}, [shots, filter, searchQuery]);

	const shotsByScene = useMemo(() => {
		const map: Record<string, typeof filteredShots> = {};
		for (const shot of filteredShots) {
			if (!map[shot.sceneRefId]) map[shot.sceneRefId] = [];
			map[shot.sceneRefId].push(shot);
		}
		return map;
	}, [filteredShots]);

	// Only show scenes that have shots
	const scenesWithShots = useMemo(
		() => scenes.filter((s) => (shotsByScene[s.id]?.length ?? 0) > 0),
		[scenes, shotsByScene]
	);

	if (shots.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
				<FileTextIcon className="mb-3 h-10 w-10 opacity-40" />
				<p className="text-sm font-medium">No Shots Generated</p>
				<p className="text-xs mt-1 max-w-[200px]">
					Generate shots from the Structure tab to see the breakdown here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-0">
			{/* Toolbar: count, search, filter, view toggle */}
			<div className="flex items-center gap-1 px-1.5 py-1 border-b">
				<span className="text-[10px] text-muted-foreground shrink-0">
					{filteredShots.length !== shots.length
						? `${filteredShots.length}/`
						: ""}
					{shots.length}
				</span>
				<div className="flex-1 relative">
					<SearchIcon className="absolute left-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground pointer-events-none" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search shots..."
						className="w-full h-5 pl-4 pr-1 text-[10px] rounded border bg-transparent focus:outline-none focus:ring-1 focus:ring-primary"
						aria-label="Search shots"
					/>
				</div>
				<select
					value={filter}
					onChange={(e) => setFilter(e.target.value as typeof filter)}
					className="h-5 text-[10px] rounded border bg-transparent px-0.5 shrink-0"
					aria-label="Filter shots"
				>
					<option value="all">All</option>
					<option value="has-image">Has Image</option>
					<option value="has-video">Has Video</option>
					<option value="incomplete">Incomplete</option>
				</select>
				<div className="flex items-center gap-0.5 shrink-0">
					<button
						type="button"
						onClick={() => setViewMode("list")}
						className={cn(
							"p-0.5 rounded transition-colors",
							viewMode === "list"
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-muted"
						)}
						aria-label="List view"
					>
						<ListIcon className="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={() => setViewMode("grid")}
						className={cn(
							"p-0.5 rounded transition-colors",
							viewMode === "grid"
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-muted"
						)}
						aria-label="Grid view"
					>
						<GridIcon className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Bulk action bar */}
			{selectedShotIds.size > 0 && (
				<div className="flex items-center justify-between px-1.5 py-1 border-b bg-primary/5">
					<span className="text-[10px] font-medium text-primary">
						{selectedShotIds.size} selected
					</span>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={handleDuplicateSelected}
							className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted transition-colors"
							aria-label="Duplicate selected shots"
						>
							<CopyIcon className="h-3 w-3" />
							Duplicate
						</button>
						<button
							type="button"
							onClick={handleBulkGenerate}
							className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted transition-colors"
							aria-label="Generate images for selected shots"
						>
							<SparklesIcon className="h-3 w-3" />
							Generate
						</button>
						<button
							type="button"
							onClick={handleBulkCopyPrompts}
							className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted transition-colors"
							aria-label="Copy prompts for selected shots"
						>
							<ClipboardCopyIcon className="h-3 w-3" />
							Copy
						</button>
						<button
							type="button"
							onClick={deleteSelectedShots}
							className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-destructive hover:bg-destructive/10 transition-colors"
							aria-label="Delete selected shots"
						>
							<Trash2Icon className="h-3 w-3" />
							Delete
						</button>
						<button
							type="button"
							onClick={clearShotSelection}
							className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted transition-colors"
						>
							Clear
						</button>
					</div>
				</div>
			)}

			{scenesWithShots.map((scene) => {
				const sceneShots = shotsByScene[scene.id] || [];
				return (
					<div key={scene.id}>
						{/* Sticky scene header */}
						<div className="sticky top-0 z-10 flex items-center gap-1.5 bg-background border-b px-1.5 py-1.5">
							<MapPinIcon className="h-3 w-3 text-muted-foreground shrink-0" />
							<span className="text-[10px] font-medium truncate flex-1">
								{scene.name || scene.location}
							</span>
							<button
								type="button"
								onClick={() => handleAddShot(scene.id)}
								className="p-0.5 rounded hover:bg-muted transition-colors"
								aria-label={`Add shot to ${scene.name || scene.location}`}
							>
								<PlusIcon className="h-3 w-3 text-muted-foreground" />
							</button>
							<Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
								{sceneShots.length}
							</Badge>
						</div>

						{viewMode === "grid" ? (
							<div className="grid grid-cols-4 gap-1 p-1">
								{sceneShots.map((shot) => (
									<button
										key={shot.id}
										type="button"
										onClick={(e) => handleShotClick(shot.id, e)}
										draggable
										onDragStart={(e) => handleDragStart(shot.id, e)}
										onDragOver={(e) => handleDragOver(shot.id, e)}
										onDrop={() => handleDrop(shot.id, sceneShots)}
										onDragEnd={handleDragEnd}
										className={cn(
											"relative aspect-video rounded border overflow-hidden transition-colors",
											selectedItemId === shot.id
												? "ring-2 ring-primary"
												: selectedShotIds.has(shot.id)
													? "ring-2 ring-blue-400"
													: "hover:ring-1 hover:ring-muted-foreground/30",
											dragOverId === shot.id && "ring-2 ring-yellow-400"
										)}
									>
										{shot.imageUrl ? (
											<img
												src={shot.imageUrl}
												alt={shot.actionSummary || `Shot ${shot.index + 1}`}
												className="w-full h-full object-cover"
											/>
										) : (
											<div className="w-full h-full bg-muted flex items-center justify-center">
												<ImageIcon className="h-4 w-4 text-muted-foreground/40" />
											</div>
										)}
										<span className="absolute top-0.5 left-0.5 bg-black/60 text-white text-[8px] px-1 rounded font-mono">
											{String(shot.index + 1).padStart(2, "0")}
										</span>
										<span className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5">
											<ShotStatusDot status={shot.imageStatus} label="Image" />
											<ShotStatusDot status={shot.videoStatus} label="Video" />
										</span>
									</button>
								))}
							</div>
						) : (
							sceneShots.map((shot) => (
								<button
									key={shot.id}
									type="button"
									onClick={(e) => handleShotClick(shot.id, e)}
									draggable
									onDragStart={(e) => handleDragStart(shot.id, e)}
									onDragOver={(e) => handleDragOver(shot.id, e)}
									onDrop={() => handleDrop(shot.id, sceneShots)}
									onDragEnd={handleDragEnd}
									className={cn(
										"flex items-center gap-1.5 w-full px-1.5 py-1 text-left transition-colors",
										selectedItemId === shot.id
											? "bg-primary/10 text-primary"
											: selectedShotIds.has(shot.id)
												? "bg-blue-500/10 text-blue-600"
												: "hover:bg-muted",
										dragOverId === shot.id && "border-t-2 border-primary"
									)}
								>
									<span className="text-[9px] font-mono text-muted-foreground w-5 shrink-0 text-right">
										{String(shot.index + 1).padStart(2, "0")}
									</span>
									{shot.shotSize && (
										<Badge
											variant="outline"
											className="text-[8px] px-1 py-0 h-3.5 font-mono shrink-0"
										>
											{shot.shotSize}
										</Badge>
									)}
									{shot.narrativeFunction &&
										NARRATIVE_BADGE[shot.narrativeFunction] && (
											<span
												className={cn(
													"text-[7px] px-0.5 py-0 rounded font-bold shrink-0 leading-tight",
													NARRATIVE_BADGE[shot.narrativeFunction].cls
												)}
												title={shot.narrativeFunction}
											>
												{NARRATIVE_BADGE[shot.narrativeFunction].label}
											</span>
										)}
									{shot.cameraMovement && (
										<CameraIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
									)}
									<span className="text-[10px] truncate flex-1 min-w-0">
										{shot.actionSummary || "—"}
									</span>
									{shot.dialogue && (
										<MessageSquareIcon className="h-2.5 w-2.5 shrink-0 text-blue-500" />
									)}
									{shot.characterNames && shot.characterNames.length > 0 && (
										<span className="flex items-center gap-0.5 shrink-0">
											<UserIcon className="h-2.5 w-2.5 text-muted-foreground" />
											<span className="text-[9px] text-muted-foreground">
												{shot.characterNames.length}
											</span>
										</span>
									)}
									<span className="flex items-center gap-0.5 shrink-0">
										<ShotStatusDot status={shot.imageStatus} label="Image" />
										<ShotStatusDot status={shot.videoStatus} label="Video" />
									</span>
								</button>
							))
						)}
					</div>
				);
			})}
		</div>
	);
}
