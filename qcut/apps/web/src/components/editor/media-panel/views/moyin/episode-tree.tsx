/**
 * EpisodeTree — expandable hierarchy showing episodes → scenes → shots.
 * Supports selection, expand/collapse, and status indicators.
 */

import { useState, useMemo, useCallback, useRef } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CircleIcon,
	CheckCircle2Icon,
	ClockIcon,
	FilmIcon,
	FileTextIcon,
	MapPinIcon,
	PlusIcon,
} from "lucide-react";
import {
	EpisodeContextMenu,
	SceneContextMenu,
	ShotContextMenu,
} from "./tree-context-menu";
import { EpisodeDialog } from "./episode-dialog";

type FilterMode = "all" | "pending" | "completed";

export function EpisodeTree() {
	const scriptData = useMoyinStore((s) => s.scriptData);
	const episodes = useMoyinStore((s) => s.episodes);
	const scenes = useMoyinStore((s) => s.scenes);
	const shots = useMoyinStore((s) => s.shots);
	const characters = useMoyinStore((s) => s.characters);
	const selectedItemId = useMoyinStore((s) => s.selectedItemId);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const reorderScenes = useMoyinStore((s) => s.reorderScenes);

	const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(
		new Set()
	);
	const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState<FilterMode>("all");
	const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false);
	const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
	const [editingSceneName, setEditingSceneName] = useState("");
	const [characterFilter, setCharacterFilter] = useState<string | null>(null);
	const updateEpisode = useMoyinStore((s) => s.updateEpisode);
	const updateScene = useMoyinStore((s) => s.updateScene);

	const toggleEpisode = (id: string) => {
		setExpandedEpisodes((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleScene = (id: string) => {
		setExpandedScenes((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const [dragOverSceneId, setDragOverSceneId] = useState<string | null>(null);
	const dragSceneRef = useRef<{ sceneId: string; episodeId: string } | null>(
		null
	);

	const handleSceneDragStart = useCallback(
		(sceneId: string, episodeId: string, e: React.DragEvent) => {
			dragSceneRef.current = { sceneId, episodeId };
			e.dataTransfer.effectAllowed = "move";
		},
		[]
	);
	const handleSceneDragOver = useCallback(
		(sceneId: string, e: React.DragEvent) => {
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			setDragOverSceneId(sceneId);
		},
		[]
	);
	const handleSceneDrop = useCallback(
		(targetSceneId: string, episodeId: string, sceneIds: string[]) => {
			const from = dragSceneRef.current;
			if (
				!from ||
				from.sceneId === targetSceneId ||
				from.episodeId !== episodeId
			) {
				setDragOverSceneId(null);
				return;
			}
			const targetIdx = sceneIds.indexOf(targetSceneId);
			reorderScenes(episodeId, from.sceneId, targetIdx);
			setDragOverSceneId(null);
			dragSceneRef.current = null;
		},
		[reorderScenes]
	);
	const handleSceneDragEnd = useCallback(() => {
		setDragOverSceneId(null);
		dragSceneRef.current = null;
	}, []);

	// Compute shot counts per scene
	const shotsByScene = useMemo(() => {
		const map: Record<string, typeof shots> = {};
		for (const shot of shots) {
			if (!map[shot.sceneRefId]) map[shot.sceneRefId] = [];
			map[shot.sceneRefId].push(shot);
		}
		return map;
	}, [shots]);

	// Compute completed shots per scene
	const completedShotCount = (sceneId: string) => {
		const sceneShots = shotsByScene[sceneId] || [];
		return sceneShots.filter((s) => s.imageStatus === "completed").length;
	};

	// Total stats
	const totalShots = shots.length;
	const totalCompleted = shots.filter(
		(s) => s.imageStatus === "completed"
	).length;

	if (parseStatus !== "ready" || !scriptData) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
				<FileTextIcon className="mb-3 h-10 w-10 opacity-40" />
				<p className="text-sm font-medium">No Script Parsed</p>
				<p className="text-xs mt-1 max-w-[200px]">
					Paste a screenplay in the left panel and click Parse Script to begin.
				</p>
			</div>
		);
	}

	// Filter scenes based on filter mode + character filter
	const filterScene = (sceneId: string): boolean => {
		const sceneShots = shotsByScene[sceneId] || [];
		// Character filter
		if (characterFilter) {
			const hasChar = sceneShots.some((s) =>
				s.characterIds?.includes(characterFilter)
			);
			if (!hasChar) return false;
		}
		if (filter === "all") return true;
		if (sceneShots.length === 0) return filter === "pending";
		const allCompleted = sceneShots.every((s) => s.imageStatus === "completed");
		return filter === "completed" ? allCompleted : !allCompleted;
	};

	return (
		<div className="space-y-2">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{scriptData.title && (
						<span className="text-sm font-medium">{scriptData.title}</span>
					)}
					{scriptData.genre && (
						<Badge variant="outline" className="text-[10px]">
							{scriptData.genre}
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="text"
						size="sm"
						className="h-5 text-[10px] px-1.5"
						onClick={() => setEpisodeDialogOpen(true)}
					>
						<PlusIcon className="mr-0.5 h-2.5 w-2.5" />
						Episode
					</Button>
					<span className="text-xs text-muted-foreground">
						{totalCompleted}/{totalShots}
					</span>
				</div>
			</div>

			<EpisodeDialog
				open={episodeDialogOpen}
				onOpenChange={setEpisodeDialogOpen}
			/>

			{/* Expand/Collapse all */}
			{episodes.length > 1 && (
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() =>
							setExpandedEpisodes(new Set(episodes.map((ep) => ep.id)))
						}
						className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
						aria-label="Expand all episodes"
					>
						Expand All
					</button>
					<span className="text-[9px] text-muted-foreground">|</span>
					<button
						type="button"
						onClick={() => setExpandedEpisodes(new Set())}
						className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
						aria-label="Collapse all episodes"
					>
						Collapse All
					</button>
				</div>
			)}

			{/* Episode quick-jump pills */}
			{episodes.length > 1 && (
				<div
					className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin"
					aria-label="Episode navigation"
				>
					{episodes.map((ep) => (
						<button
							key={ep.id}
							type="button"
							onClick={() => {
								setExpandedEpisodes(new Set([ep.id]));
								setSelectedItem(ep.id, "episode");
							}}
							className={cn(
								"shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border",
								selectedItemId === ep.id
									? "bg-primary text-primary-foreground border-primary"
									: "text-muted-foreground border-muted hover:bg-muted"
							)}
						>
							{ep.title}
						</button>
					))}
				</div>
			)}

			{/* Filter tabs */}
			<div className="flex items-center gap-1">
				{(["all", "pending", "completed"] as const).map((mode) => (
					<button
						key={mode}
						type="button"
						onClick={() => setFilter(mode)}
						className={cn(
							"px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
							filter === mode
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-muted"
						)}
					>
						{mode === "all"
							? "All"
							: mode === "pending"
								? "Pending"
								: "Completed"}
					</button>
				))}
				<div className="flex-1" />
				<span className="text-[10px] text-muted-foreground">
					{characters.length} chars, {scenes.length} scenes
				</span>
			</div>

			{/* Character filter pills */}
			{characters.length > 0 && (
				<div
					className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin"
					aria-label="Character filter"
				>
					<button
						type="button"
						onClick={() => setCharacterFilter(null)}
						className={cn(
							"shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border",
							!characterFilter
								? "bg-primary text-primary-foreground border-primary"
								: "text-muted-foreground border-muted hover:bg-muted"
						)}
					>
						All
					</button>
					{characters.map((ch) => (
						<button
							key={ch.id}
							type="button"
							onClick={() =>
								setCharacterFilter(characterFilter === ch.id ? null : ch.id)
							}
							className={cn(
								"shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border",
								characterFilter === ch.id
									? "bg-primary text-primary-foreground border-primary"
									: "text-muted-foreground border-muted hover:bg-muted"
							)}
						>
							{ch.name}
						</button>
					))}
				</div>
			)}

			{/* Tree */}
			<div className="space-y-0.5">
				{episodes.length > 0 ? (
					episodes.map((ep, epIdx) => {
						const epSceneIds = ep.sceneIds || [];
						const filteredSceneIds = epSceneIds.filter(filterScene);
						if (filter !== "all" && filteredSceneIds.length === 0) return null;

						const isExpanded = expandedEpisodes.has(ep.id);
						const epShots = epSceneIds.flatMap(
							(sid) => shotsByScene[sid] || []
						);
						const epCompleted = epShots.filter(
							(s) => s.imageStatus === "completed"
						).length;

						return (
							<div key={ep.id}>
								{/* Episode row */}
								<div
									className={cn(
										"group flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs transition-colors",
										selectedItemId === ep.id
											? "bg-primary/10 text-primary"
											: "hover:bg-muted"
									)}
								>
									<button
										type="button"
										onClick={() => {
											toggleEpisode(ep.id);
											setSelectedItem(ep.id, "episode");
										}}
										onDoubleClick={(e) => {
											e.stopPropagation();
											setEditingEpisodeId(ep.id);
											setEditingTitle(ep.title || `Episode ${epIdx + 1}`);
										}}
										className="flex items-center gap-1.5 flex-1 min-w-0"
									>
										{isExpanded ? (
											<ChevronDownIcon className="h-3 w-3 shrink-0" />
										) : (
											<ChevronRightIcon className="h-3 w-3 shrink-0" />
										)}
										<FilmIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
										{editingEpisodeId === ep.id ? (
											<input
												type="text"
												value={editingTitle}
												onChange={(e) => setEditingTitle(e.target.value)}
												onBlur={() => {
													if (editingTitle.trim())
														updateEpisode(ep.id, {
															title: editingTitle.trim(),
														});
													setEditingEpisodeId(null);
												}}
												onKeyDown={(e) => {
													if (e.key === "Enter") {
														if (editingTitle.trim())
															updateEpisode(ep.id, {
																title: editingTitle.trim(),
															});
														setEditingEpisodeId(null);
													} else if (e.key === "Escape") {
														setEditingEpisodeId(null);
													}
												}}
												className="flex-1 min-w-0 h-5 px-1 text-xs font-medium border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
												autoFocus
												onClick={(e) => e.stopPropagation()}
												aria-label="Edit episode title"
											/>
										) : (
											<span className="flex-1 truncate text-left font-medium">
												{ep.title || `Episode ${epIdx + 1}`}
											</span>
										)}
									</button>
									<Badge
										variant="secondary"
										className={cn(
											"text-[9px] px-1 py-0",
											epShots.length > 0 && epCompleted === epShots.length
												? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
												: epCompleted > 0
													? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
													: ""
										)}
									>
										{epCompleted}/{epShots.length}
									</Badge>
									<EpisodeContextMenu
										episodeId={ep.id}
										onEdit={() => setSelectedItem(ep.id, "episode")}
									/>
								</div>

								{/* Scenes under episode */}
								{isExpanded && (
									<div className="ml-3 border-l pl-2 space-y-0.5 mt-0.5">
										{filteredSceneIds.map((sceneId) => {
											const scene = scenes.find((s) => s.id === sceneId);
											if (!scene) return null;
											const sceneShots = shotsByScene[sceneId] || [];
											const hasShots = sceneShots.length > 0;
											const sceneExpanded = expandedScenes.has(sceneId);
											const completed = completedShotCount(sceneId);
											const total = sceneShots.length;

											return (
												<div key={sceneId}>
													{/* Scene row */}
													<div
														draggable
														onDragStart={(e) =>
															handleSceneDragStart(sceneId, ep.id, e)
														}
														onDragOver={(e) => handleSceneDragOver(sceneId, e)}
														onDrop={() =>
															handleSceneDrop(sceneId, ep.id, filteredSceneIds)
														}
														onDragEnd={handleSceneDragEnd}
														className={cn(
															"group flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs transition-colors",
															selectedItemId === sceneId
																? "bg-primary/10 text-primary"
																: "hover:bg-muted",
															dragOverSceneId === sceneId &&
																"border-t-2 border-primary"
														)}
													>
														<button
															type="button"
															onClick={() => {
																if (hasShots) toggleScene(sceneId);
																setSelectedItem(sceneId, "scene");
															}}
															onDoubleClick={(e) => {
																e.stopPropagation();
																setEditingSceneId(sceneId);
																setEditingSceneName(
																	scene.name || scene.location
																);
															}}
															className="flex items-center gap-1.5 flex-1 min-w-0"
														>
															{hasShots ? (
																sceneExpanded ? (
																	<ChevronDownIcon className="h-2.5 w-2.5 shrink-0" />
																) : (
																	<ChevronRightIcon className="h-2.5 w-2.5 shrink-0" />
																)
															) : (
																<span className="w-2.5" />
															)}
															<MapPinIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
															{editingSceneId === sceneId ? (
																<input
																	type="text"
																	value={editingSceneName}
																	onChange={(e) =>
																		setEditingSceneName(e.target.value)
																	}
																	onBlur={() => {
																		if (editingSceneName.trim())
																			updateScene(sceneId, {
																				name: editingSceneName.trim(),
																			});
																		setEditingSceneId(null);
																	}}
																	onKeyDown={(e) => {
																		if (e.key === "Enter") {
																			if (editingSceneName.trim())
																				updateScene(sceneId, {
																					name: editingSceneName.trim(),
																				});
																			setEditingSceneId(null);
																		} else if (e.key === "Escape") {
																			setEditingSceneId(null);
																		}
																	}}
																	className="flex-1 min-w-0 h-4 px-1 text-[11px] border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
																	autoFocus
																	onClick={(e) => e.stopPropagation()}
																	aria-label="Edit scene name"
																/>
															) : (
																<span className="flex-1 truncate text-left">
																	{scene.name || scene.location}
																</span>
															)}
														</button>
														<StatusIcon completed={completed} total={total} />
														{hasShots && (
															<span className="text-[9px] text-muted-foreground">
																{completed}/{total}
															</span>
														)}
														<SceneContextMenu
															sceneId={sceneId}
															onEdit={() => setSelectedItem(sceneId, "scene")}
														/>
													</div>

													{/* Shots under scene */}
													{sceneExpanded && hasShots && (
														<div className="ml-3 border-l pl-2 space-y-px mt-0.5">
															{sceneShots.map((shot) => (
																<div
																	key={shot.id}
																	className={cn(
																		"group flex items-center gap-1.5 w-full rounded px-1.5 py-0.5 text-[11px] transition-colors",
																		selectedItemId === shot.id
																			? "bg-primary/10 text-primary"
																			: "hover:bg-muted"
																	)}
																>
																	<button
																		type="button"
																		onClick={() =>
																			setSelectedItem(shot.id, "shot")
																		}
																		className="flex items-center gap-1.5 flex-1 min-w-0"
																	>
																		<span className="w-4 text-right font-mono text-muted-foreground text-[9px]">
																			{String(shot.index + 1).padStart(2, "0")}
																		</span>
																		{shot.shotSize && (
																			<Badge
																				variant="outline"
																				className="text-[8px] px-1 py-0 font-mono"
																			>
																				{shot.shotSize}
																			</Badge>
																		)}
																		<span className="flex-1 truncate text-left text-muted-foreground">
																			{shot.actionSummary || "—"}
																		</span>
																	</button>
																	<ShotStatusDot status={shot.imageStatus} />
																	<ShotContextMenu shotId={shot.id} />
																</div>
															))}
														</div>
													)}
												</div>
											);
										})}
									</div>
								)}
							</div>
						);
					})
				) : (
					/* No episodes — show flat scene list */
					<div className="space-y-0.5">
						{scenes
							.filter((s) => filterScene(s.id))
							.map((scene, i) => {
								const sceneShots = shotsByScene[scene.id] || [];
								const completed = completedShotCount(scene.id);
								return (
									<button
										key={scene.id}
										type="button"
										onClick={() => setSelectedItem(scene.id, "scene")}
										className={cn(
											"flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs transition-colors",
											selectedItemId === scene.id
												? "bg-primary/10 text-primary"
												: "hover:bg-muted"
										)}
									>
										<span className="text-muted-foreground text-[10px]">
											#{i + 1}
										</span>
										<MapPinIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
										<span className="flex-1 truncate text-left">
											{scene.name || scene.location}
										</span>
										<StatusIcon
											completed={completed}
											total={sceneShots.length}
										/>
									</button>
								);
							})}
					</div>
				)}
			</div>
		</div>
	);
}

function StatusIcon({
	completed,
	total,
}: {
	completed: number;
	total: number;
}) {
	const label =
		total === 0
			? "No shots"
			: completed === total
				? "All completed"
				: completed > 0
					? `${completed}/${total} completed`
					: "Pending";
	if (total === 0)
		return (
			<CircleIcon
				className="h-2.5 w-2.5 text-muted-foreground/40"
				aria-label={label}
			/>
		);
	if (completed === total)
		return (
			<CheckCircle2Icon
				className="h-2.5 w-2.5 text-green-500"
				aria-label={label}
			/>
		);
	if (completed > 0)
		return (
			<ClockIcon className="h-2.5 w-2.5 text-yellow-500" aria-label={label} />
		);
	return (
		<CircleIcon
			className="h-2.5 w-2.5 text-muted-foreground/40"
			aria-label={label}
		/>
	);
}

function ShotStatusDot({ status }: { status: string }) {
	if (status === "completed")
		return (
			<span
				className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0"
				title="Completed"
			/>
		);
	if (status === "generating")
		return (
			<span
				className="h-1.5 w-1.5 rounded-full bg-yellow-500 shrink-0 animate-pulse"
				title="Generating"
			/>
		);
	if (status === "failed")
		return (
			<span
				className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0"
				title="Failed"
			/>
		);
	return null;
}
