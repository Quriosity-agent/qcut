/**
 * EpisodeTree — expandable hierarchy showing episodes → scenes → shots.
 * Supports selection, expand/collapse, and status indicators.
 */

import { useState, useMemo } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import {
	EpisodeContextMenu,
	SceneContextMenu,
	ShotContextMenu,
} from "./tree-context-menu";

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

	const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(
		new Set(),
	);
	const [expandedScenes, setExpandedScenes] = useState<Set<string>>(
		new Set(),
	);
	const [filter, setFilter] = useState<FilterMode>("all");

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
		(s) => s.imageStatus === "completed",
	).length;

	if (parseStatus !== "ready" || !scriptData) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
				<FileTextIcon className="mb-3 h-10 w-10 opacity-40" />
				<p className="text-sm font-medium">No Script Parsed</p>
				<p className="text-xs mt-1 max-w-[200px]">
					Paste a screenplay in the left panel and click Parse Script to
					begin.
				</p>
			</div>
		);
	}

	// Filter scenes based on filter mode
	const filterScene = (sceneId: string): boolean => {
		if (filter === "all") return true;
		const sceneShots = shotsByScene[sceneId] || [];
		if (sceneShots.length === 0) return filter === "pending";
		const allCompleted = sceneShots.every(
			(s) => s.imageStatus === "completed",
		);
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
				<span className="text-xs text-muted-foreground">
					{totalCompleted}/{totalShots}
				</span>
			</div>

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
								: "text-muted-foreground hover:bg-muted",
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

			{/* Tree */}
			<div className="space-y-0.5">
				{episodes.length > 0 ? (
					episodes.map((ep, epIdx) => {
						const epSceneIds = ep.sceneIds || [];
						const filteredSceneIds = epSceneIds.filter(filterScene);
						if (filter !== "all" && filteredSceneIds.length === 0) return null;

						const isExpanded = expandedEpisodes.has(ep.id);
						const epShots = epSceneIds.flatMap(
							(sid) => shotsByScene[sid] || [],
						);
						const epCompleted = epShots.filter(
							(s) => s.imageStatus === "completed",
						).length;

						return (
							<div key={ep.id}>
								{/* Episode row */}
								<div
									className={cn(
										"group flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs transition-colors",
										selectedItemId === ep.id
											? "bg-primary/10 text-primary"
											: "hover:bg-muted",
									)}
								>
									<button
										type="button"
										onClick={() => {
											toggleEpisode(ep.id);
											setSelectedItem(ep.id, "episode");
										}}
										className="flex items-center gap-1.5 flex-1 min-w-0"
									>
										{isExpanded ? (
											<ChevronDownIcon className="h-3 w-3 shrink-0" />
										) : (
											<ChevronRightIcon className="h-3 w-3 shrink-0" />
										)}
										<FilmIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
										<span className="flex-1 truncate text-left font-medium">
											{ep.title || `Episode ${epIdx + 1}`}
										</span>
									</button>
									<Badge
										variant="secondary"
										className="text-[9px] px-1 py-0"
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
														className={cn(
															"group flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs transition-colors",
															selectedItemId === sceneId
																? "bg-primary/10 text-primary"
																: "hover:bg-muted",
														)}
													>
														<button
															type="button"
															onClick={() => {
																if (hasShots) toggleScene(sceneId);
																setSelectedItem(sceneId, "scene");
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
															<span className="flex-1 truncate text-left">
																{scene.name || scene.location}
															</span>
														</button>
														<StatusIcon
															completed={completed}
															total={total}
														/>
														{hasShots && (
															<span className="text-[9px] text-muted-foreground">
																{completed}/{total}
															</span>
														)}
														<SceneContextMenu
															sceneId={sceneId}
															onEdit={() =>
																setSelectedItem(sceneId, "scene")
															}
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
																			: "hover:bg-muted",
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
																			{String(shot.index + 1).padStart(
																				2,
																				"0",
																			)}
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
																	<ShotStatusDot
																		status={shot.imageStatus}
																	/>
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
												: "hover:bg-muted",
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
}: { completed: number; total: number }) {
	if (total === 0) return <CircleIcon className="h-2.5 w-2.5 text-muted-foreground/40" />;
	if (completed === total)
		return <CheckCircle2Icon className="h-2.5 w-2.5 text-green-500" />;
	if (completed > 0)
		return <ClockIcon className="h-2.5 w-2.5 text-yellow-500" />;
	return <CircleIcon className="h-2.5 w-2.5 text-muted-foreground/40" />;
}

function ShotStatusDot({ status }: { status: string }) {
	if (status === "completed")
		return <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />;
	if (status === "generating")
		return <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 shrink-0 animate-pulse" />;
	if (status === "failed")
		return <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />;
	return null;
}
