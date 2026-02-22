/**
 * SceneList — step 3: review and edit extracted scenes before generation.
 */

import { useState, useCallback, useMemo } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type { ScriptScene } from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	CheckIcon,
	Loader2,
	MapPinIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	SparklesIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";

const TIME_OPTIONS = ["白天", "夜晚", "黄昏", "清晨", "下午", "正午", "凌晨"];

function SceneCard({
	scene,
	index,
	onUpdate,
	onRemove,
}: {
	scene: ScriptScene;
	index: number;
	onUpdate: (id: string, updates: Partial<ScriptScene>) => void;
	onRemove: (id: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Partial<ScriptScene>>({});

	const startEdit = useCallback(() => {
		setDraft({
			name: scene.name,
			location: scene.location,
			time: scene.time,
			atmosphere: scene.atmosphere,
			visualPrompt: scene.visualPrompt,
		});
		setEditing(true);
	}, [scene]);

	const cancelEdit = useCallback(() => {
		setDraft({});
		setEditing(false);
	}, []);

	const saveEdit = useCallback(() => {
		onUpdate(scene.id, draft);
		setEditing(false);
		setDraft({});
	}, [scene.id, draft, onUpdate]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") cancelEdit();
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit();
	};

	if (editing) {
		return (
			<Card
				className="border border-primary/30 shadow-none"
				onKeyDown={handleKeyDown}
			>
				<CardContent className="px-3 py-3 space-y-2">
					<div className="space-y-1">
						<Label htmlFor="scene-name" className="text-[10px]">
							Name
						</Label>
						<Input
							id="scene-name"
							className="h-7 text-xs"
							value={draft.name ?? ""}
							placeholder="Scene name"
							onChange={(e) =>
								setDraft((d) => ({ ...d, name: e.target.value }))
							}
						/>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<div className="space-y-1">
							<Label htmlFor="scene-location" className="text-[10px]">
								Location
							</Label>
							<Input
								id="scene-location"
								className="h-7 text-xs"
								value={draft.location ?? ""}
								onChange={(e) =>
									setDraft((d) => ({ ...d, location: e.target.value }))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Time</Label>
							<Select
								value={draft.time ?? ""}
								onValueChange={(v) => setDraft((d) => ({ ...d, time: v }))}
							>
								<SelectTrigger className="h-7 text-xs">
									<SelectValue placeholder="Time" />
								</SelectTrigger>
								<SelectContent>
									{TIME_OPTIONS.map((t) => (
										<SelectItem key={t} value={t} className="text-xs">
											{t}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-1">
						<Label htmlFor="scene-atmosphere" className="text-[10px]">
							Atmosphere
						</Label>
						<Textarea
							id="scene-atmosphere"
							className="text-xs min-h-[48px] resize-none"
							rows={2}
							value={draft.atmosphere ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, atmosphere: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="scene-visual-prompt" className="text-[10px]">
							Visual Prompt (EN)
						</Label>
						<Textarea
							id="scene-visual-prompt"
							className="text-xs min-h-[48px] resize-none"
							rows={2}
							placeholder="English prompt for image generation"
							value={draft.visualPrompt ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, visualPrompt: e.target.value }))
							}
						/>
					</div>
					<div className="flex items-center gap-1.5 pt-1">
						<Button size="sm" className="h-6 text-xs px-2" onClick={saveEdit}>
							<CheckIcon className="mr-1 h-3 w-3" />
							Save
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-6 text-xs px-2"
							onClick={cancelEdit}
						>
							<XIcon className="mr-1 h-3 w-3" />
							Cancel
						</Button>
						<div className="flex-1" />
						<Button
							variant="text"
							size="sm"
							className="h-6 text-xs px-2 text-destructive hover:text-destructive"
							onClick={() => {
								if (window.confirm("Delete this scene? This cannot be undone."))
									onRemove(scene.id);
							}}
						>
							<Trash2Icon className="h-3 w-3" />
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="border shadow-none group">
			<CardHeader className="pb-1 pt-3 px-3">
				<CardTitle className="text-sm flex items-center gap-2">
					<span className="text-muted-foreground text-xs">#{index + 1}</span>
					{scene.name || scene.location}
					<button
						type="button"
						onClick={startEdit}
						className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
						aria-label={`Edit scene ${index + 1}`}
					>
						<PencilIcon className="h-3 w-3 text-muted-foreground" />
					</button>
				</CardTitle>
			</CardHeader>
			<CardContent className="px-3 pb-3 pt-1 space-y-1">
				{scene.location && scene.name && (
					<p className="text-xs text-muted-foreground">{scene.location}</p>
				)}
				{scene.atmosphere && (
					<p className="text-xs text-muted-foreground line-clamp-2">
						{scene.atmosphere}
					</p>
				)}
				{scene.visualPrompt && (
					<p className="text-[10px] text-blue-600 dark:text-blue-400 line-clamp-2">
						{scene.visualPrompt}
					</p>
				)}
				<div className="flex flex-wrap gap-1">
					{scene.time && (
						<Badge variant="outline" className="text-[10px] px-1.5">
							{scene.time}
						</Badge>
					)}
					{scene.tags?.map((tag) => (
						<Badge key={tag} variant="secondary" className="text-[10px] px-1">
							{tag}
						</Badge>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

export function SceneList() {
	const scenes = useMoyinStore((s) => s.scenes);
	const updateScene = useMoyinStore((s) => s.updateScene);
	const addScene = useMoyinStore((s) => s.addScene);
	const removeScene = useMoyinStore((s) => s.removeScene);
	const enhanceScenes = useMoyinStore((s) => s.enhanceScenes);
	const calibrationStatus = useMoyinStore((s) => s.sceneCalibrationStatus);
	const calibrationError = useMoyinStore((s) => s.calibrationError);

	const isCalibrating = calibrationStatus === "calibrating";
	const [searchQuery, setSearchQuery] = useState("");

	const filteredScenes = useMemo(() => {
		if (!searchQuery.trim()) return scenes;
		const q = searchQuery.toLowerCase();
		return scenes.filter(
			(s) =>
				(s.name || "").toLowerCase().includes(q) ||
				(s.location || "").toLowerCase().includes(q) ||
				(s.time || "").toLowerCase().includes(q)
		);
	}, [scenes, searchQuery]);

	const handleAdd = useCallback(() => {
		addScene({
			id: `scene_${Date.now()}`,
			location: "New Location",
			time: "白天",
			atmosphere: "",
		});
	}, [addScene]);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					{scenes.length} scene{scenes.length !== 1 ? "s" : ""} extracted
				</p>
				<div className="flex items-center gap-1">
					<Button
						variant="text"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={enhanceScenes}
						disabled={isCalibrating || scenes.length === 0}
					>
						{isCalibrating ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<SparklesIcon className="mr-1 h-3 w-3" />
						)}
						{calibrationStatus === "done" ? "Enhanced" : "AI Enhance"}
					</Button>
					<Button
						variant="text"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={handleAdd}
						aria-label="Add scene"
					>
						<PlusIcon className="mr-1 h-3 w-3" />
						Add
					</Button>
				</div>
			</div>

			{scenes.length > 0 && (
				<div className="relative">
					<SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
					<Input
						className="h-7 text-xs pl-7 pr-7"
						placeholder="Search scenes..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
							aria-label="Clear search"
						>
							<XIcon className="h-3 w-3 text-muted-foreground" />
						</button>
					)}
				</div>
			)}

			{calibrationError && calibrationStatus === "error" && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
					{calibrationError}
				</div>
			)}

			{isCalibrating && scenes.length > 0 && (
				<div className="space-y-2" aria-label="Loading scenes">
					{Array.from({ length: Math.min(scenes.length, 3) }).map((_, i) => (
						<div
							key={`skel-${
								// biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
								i
							}`}
							className="rounded-lg border p-3 space-y-2 animate-pulse"
						>
							<div className="flex items-center gap-2">
								<div className="h-3 w-6 rounded bg-muted" />
								<div className="h-3 w-32 rounded bg-muted" />
							</div>
							<div className="h-2.5 w-full rounded bg-muted" />
							<div className="flex gap-1">
								<div className="h-3 w-12 rounded bg-muted" />
								<div className="h-3 w-16 rounded bg-muted" />
							</div>
						</div>
					))}
				</div>
			)}

			{searchQuery && filteredScenes.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
					<SearchIcon className="mb-2 h-6 w-6 opacity-40" />
					<p className="text-xs">No scenes match "{searchQuery}"</p>
				</div>
			) : scenes.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
					<MapPinIcon className="mb-2 h-8 w-8" />
					<p className="text-sm">No scenes found</p>
					<p className="text-xs">Go back and try a different script</p>
				</div>
			) : (
				<div className="space-y-2">
					{filteredScenes.map((scene, idx) => (
						<SceneCard
							key={scene.id}
							scene={scene}
							index={idx}
							onUpdate={updateScene}
							onRemove={removeScene}
						/>
					))}
				</div>
			)}
		</div>
	);
}
