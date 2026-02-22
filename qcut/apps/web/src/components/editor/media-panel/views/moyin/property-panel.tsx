/**
 * PropertyPanel — detail view for the selected item in the episode tree.
 * Shows different fields based on selectedItemType (character/scene/shot/episode).
 */

import { useState, useCallback } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type { ScriptCharacter, ScriptScene, Shot } from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
	CheckIcon,
	FilmIcon,
	ImageIcon,
	Loader2,
	MapPinIcon,
	PencilIcon,
	UserIcon,
	VideoIcon,
	XIcon,
} from "lucide-react";

function FieldRow({
	label,
	value,
}: {
	label: string;
	value: string | undefined;
}) {
	if (!value) return null;
	return (
		<div className="space-y-0.5">
			<p className="text-[10px] font-medium text-muted-foreground">{label}</p>
			<p className="text-xs">{value}</p>
		</div>
	);
}

// ==================== Character Detail ====================

function CharacterDetail({ char }: { char: ScriptCharacter }) {
	const updateCharacter = useMoyinStore((s) => s.updateCharacter);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Partial<ScriptCharacter>>({});

	const startEdit = useCallback(() => {
		setDraft({
			name: char.name,
			gender: char.gender,
			age: char.age,
			role: char.role,
			appearance: char.appearance,
			personality: char.personality,
		});
		setEditing(true);
	}, [char]);

	const save = useCallback(() => {
		updateCharacter(char.id, draft);
		setEditing(false);
	}, [char.id, draft, updateCharacter]);

	if (editing) {
		return (
			<div className="space-y-2">
				<div className="space-y-1">
					<Label className="text-[10px]">Name</Label>
					<Input
						className="h-7 text-xs"
						value={draft.name ?? ""}
						onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
					/>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="space-y-1">
						<Label className="text-[10px]">Gender</Label>
						<Input
							className="h-7 text-xs"
							value={draft.gender ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, gender: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Age</Label>
						<Input
							className="h-7 text-xs"
							value={draft.age ?? ""}
							onChange={(e) => setDraft((d) => ({ ...d, age: e.target.value }))}
						/>
					</div>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Role</Label>
					<Input
						className="h-7 text-xs"
						value={draft.role ?? ""}
						onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Appearance</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.appearance ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, appearance: e.target.value }))
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Personality</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.personality ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, personality: e.target.value }))
						}
					/>
				</div>
				<div className="flex gap-1.5">
					<Button size="sm" className="h-6 text-xs px-2" onClick={save}>
						<CheckIcon className="mr-1 h-3 w-3" />
						Save
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={() => setEditing(false)}
					>
						<XIcon className="mr-1 h-3 w-3" />
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-sm font-medium">{char.name}</span>
				</div>
				<Button
					variant="text"
					size="sm"
					className="h-6 text-xs px-1.5"
					onClick={startEdit}
				>
					<PencilIcon className="h-3 w-3" />
				</Button>
			</div>
			<div className="flex gap-1">
				{char.gender && (
					<Badge variant="outline" className="text-[10px]">
						{char.gender}
					</Badge>
				)}
				{char.age && (
					<Badge variant="outline" className="text-[10px]">
						{char.age}
					</Badge>
				)}
			</div>
			<FieldRow label="Role" value={char.role} />
			<FieldRow label="Appearance" value={char.appearance} />
			<FieldRow label="Personality" value={char.personality} />
			<FieldRow label="Visual Prompt (EN)" value={char.visualPromptEn} />
			{char.tags && char.tags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{char.tags.map((tag) => (
						<Badge key={tag} variant="secondary" className="text-[10px] px-1">
							{tag}
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}

// ==================== Scene Detail ====================

function SceneDetail({ scene }: { scene: ScriptScene }) {
	const updateScene = useMoyinStore((s) => s.updateScene);
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

	const save = useCallback(() => {
		updateScene(scene.id, draft);
		setEditing(false);
	}, [scene.id, draft, updateScene]);

	if (editing) {
		return (
			<div className="space-y-2">
				<div className="space-y-1">
					<Label className="text-[10px]">Name</Label>
					<Input
						className="h-7 text-xs"
						value={draft.name ?? ""}
						onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
					/>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="space-y-1">
						<Label className="text-[10px]">Location</Label>
						<Input
							className="h-7 text-xs"
							value={draft.location ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, location: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Time</Label>
						<Input
							className="h-7 text-xs"
							value={draft.time ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, time: e.target.value }))
							}
						/>
					</div>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Atmosphere</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.atmosphere ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, atmosphere: e.target.value }))
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Visual Prompt (EN)</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.visualPrompt ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, visualPrompt: e.target.value }))
						}
					/>
				</div>
				<div className="flex gap-1.5">
					<Button size="sm" className="h-6 text-xs px-2" onClick={save}>
						<CheckIcon className="mr-1 h-3 w-3" />
						Save
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={() => setEditing(false)}
					>
						<XIcon className="mr-1 h-3 w-3" />
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<MapPinIcon className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-sm font-medium">
						{scene.name || scene.location}
					</span>
				</div>
				<Button
					variant="text"
					size="sm"
					className="h-6 text-xs px-1.5"
					onClick={startEdit}
				>
					<PencilIcon className="h-3 w-3" />
				</Button>
			</div>
			<div className="flex gap-1">
				{scene.time && (
					<Badge variant="outline" className="text-[10px]">
						{scene.time}
					</Badge>
				)}
			</div>
			<FieldRow label="Location" value={scene.location} />
			<FieldRow label="Atmosphere" value={scene.atmosphere} />
			<FieldRow label="Visual Prompt" value={scene.visualPrompt} />
			<FieldRow label="Architecture" value={scene.architectureStyle} />
			<FieldRow label="Lighting" value={scene.lightingDesign} />
			<FieldRow label="Color Palette" value={scene.colorPalette} />
		</div>
	);
}

// ==================== Shot Detail ====================

function ShotDetail({ shot }: { shot: Shot }) {
	const updateShot = useMoyinStore((s) => s.updateShot);
	const generateShotImage = useMoyinStore((s) => s.generateShotImage);
	const generateShotVideo = useMoyinStore((s) => s.generateShotVideo);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Partial<Shot>>({});

	const isImageGenerating = shot.imageStatus === "generating";
	const isVideoGenerating = shot.videoStatus === "generating";

	const startEdit = useCallback(() => {
		setDraft({
			actionSummary: shot.actionSummary,
			shotSize: shot.shotSize,
			cameraMovement: shot.cameraMovement,
			dialogue: shot.dialogue,
			imagePrompt: shot.imagePrompt,
			videoPrompt: shot.videoPrompt,
		});
		setEditing(true);
	}, [shot]);

	const save = useCallback(() => {
		updateShot(shot.id, draft);
		setEditing(false);
	}, [shot.id, draft, updateShot]);

	if (editing) {
		return (
			<div className="space-y-2">
				<div className="space-y-1">
					<Label className="text-[10px]">Action Summary</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.actionSummary ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, actionSummary: e.target.value }))
						}
					/>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="space-y-1">
						<Label className="text-[10px]">Shot Size</Label>
						<Input
							className="h-7 text-xs"
							value={draft.shotSize ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, shotSize: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Camera Movement</Label>
						<Input
							className="h-7 text-xs"
							value={draft.cameraMovement ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, cameraMovement: e.target.value }))
							}
						/>
					</div>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Dialogue</Label>
					<Textarea
						className="text-xs min-h-[36px] resize-none"
						rows={1}
						value={draft.dialogue ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, dialogue: e.target.value }))
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Image Prompt</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.imagePrompt ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, imagePrompt: e.target.value }))
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Video Prompt</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.videoPrompt ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, videoPrompt: e.target.value }))
						}
					/>
				</div>
				<div className="flex gap-1.5">
					<Button size="sm" className="h-6 text-xs px-2" onClick={save}>
						<CheckIcon className="mr-1 h-3 w-3" />
						Save
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={() => setEditing(false)}
					>
						<XIcon className="mr-1 h-3 w-3" />
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<VideoIcon className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-sm font-medium">
						Shot {String(shot.index + 1).padStart(2, "0")}
					</span>
					{shot.shotSize && (
						<Badge variant="outline" className="text-[10px] font-mono">
							{shot.shotSize}
						</Badge>
					)}
				</div>
				<Button
					variant="text"
					size="sm"
					className="h-6 text-xs px-1.5"
					onClick={startEdit}
				>
					<PencilIcon className="h-3 w-3" />
				</Button>
			</div>
			<FieldRow label="Action" value={shot.actionSummary} />
			<FieldRow label="Camera" value={shot.cameraMovement} />
			<FieldRow label="Dialogue" value={shot.dialogue} />
			<FieldRow label="Image Prompt" value={shot.imagePrompt} />
			<FieldRow label="Video Prompt" value={shot.videoPrompt} />
			{shot.imageUrl && (
				<div className="rounded border overflow-hidden">
					<img
						src={shot.imageUrl}
						alt={`Shot ${shot.index + 1}`}
						className="w-full h-auto"
					/>
				</div>
			)}
			{shot.characterNames && shot.characterNames.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{shot.characterNames.map((name) => (
						<Badge key={name} variant="secondary" className="text-[10px] px-1">
							{name}
						</Badge>
					))}
				</div>
			)}

			{/* Generation buttons */}
			<div className="space-y-1.5 border-t pt-2">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					Generate
				</p>
				{shot.imageError && (
					<p className="text-[10px] text-destructive">{shot.imageError}</p>
				)}
				{shot.videoError && (
					<p className="text-[10px] text-destructive">{shot.videoError}</p>
				)}
				<div className="flex gap-1.5">
					<Button
						size="sm"
						variant={shot.imageStatus === "completed" ? "outline" : "default"}
						className="flex-1 h-7 text-xs"
						onClick={() => generateShotImage(shot.id)}
						disabled={isImageGenerating}
					>
						{isImageGenerating ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<ImageIcon className="mr-1 h-3 w-3" />
						)}
						{shot.imageStatus === "completed" ? "Regenerate" : "Image"}
					</Button>
					<Button
						size="sm"
						variant={shot.videoStatus === "completed" ? "outline" : "default"}
						className="flex-1 h-7 text-xs"
						onClick={() => generateShotVideo(shot.id)}
						disabled={isVideoGenerating || !shot.imageUrl}
					>
						{isVideoGenerating ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<VideoIcon className="mr-1 h-3 w-3" />
						)}
						{shot.videoStatus === "completed" ? "Regenerate" : "Video"}
					</Button>
				</div>
			</div>

			{/* Video preview */}
			{shot.videoUrl && (
				<div className="rounded border overflow-hidden">
					<video
						src={shot.videoUrl}
						controls
						className="w-full h-auto"
						aria-label={`Shot ${shot.index + 1} video`}
					/>
				</div>
			)}
		</div>
	);
}

// ==================== Episode Detail ====================

function EpisodeDetail({ episodeId }: { episodeId: string }) {
	const episodes = useMoyinStore((s) => s.episodes);
	const shots = useMoyinStore((s) => s.shots);
	const scenes = useMoyinStore((s) => s.scenes);
	const generateShotsForEpisode = useMoyinStore(
		(s) => s.generateShotsForEpisode
	);
	const shotGenerationStatus = useMoyinStore((s) => s.shotGenerationStatus);

	const episode = episodes.find((ep) => ep.id === episodeId);
	if (!episode) return null;

	const epScenes = scenes.filter((s) => episode.sceneIds.includes(s.id));
	const epShots = shots.filter((s) =>
		epScenes.some((sc) => sc.id === s.sceneRefId)
	);
	const isGenerating = shotGenerationStatus[episodeId] === "generating";

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1.5">
				<FilmIcon className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="text-sm font-medium">{episode.title}</span>
			</div>
			{episode.description && (
				<p className="text-xs text-muted-foreground">{episode.description}</p>
			)}
			<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
				<span>Scenes: {epScenes.length}</span>
				<span>Shots: {epShots.length}</span>
			</div>
			<Button
				size="sm"
				className="w-full h-7 text-xs"
				onClick={() => generateShotsForEpisode(episodeId)}
				disabled={isGenerating || epScenes.length === 0}
			>
				{isGenerating ? "Generating Shots..." : "Generate Shots"}
			</Button>
		</div>
	);
}

// ==================== Main PropertyPanel ====================

export function PropertyPanel() {
	const selectedItemId = useMoyinStore((s) => s.selectedItemId);
	const selectedItemType = useMoyinStore((s) => s.selectedItemType);
	const characters = useMoyinStore((s) => s.characters);
	const scenes = useMoyinStore((s) => s.scenes);
	const shots = useMoyinStore((s) => s.shots);

	if (!selectedItemId || !selectedItemType) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
				<p className="text-xs">Select an item to view details</p>
			</div>
		);
	}

	switch (selectedItemType) {
		case "character": {
			const char = characters.find((c) => c.id === selectedItemId);
			if (!char) return null;
			return <CharacterDetail char={char} />;
		}
		case "scene": {
			const scene = scenes.find((s) => s.id === selectedItemId);
			if (!scene) return null;
			return <SceneDetail scene={scene} />;
		}
		case "shot": {
			const shot = shots.find((s) => s.id === selectedItemId);
			if (!shot) return null;
			return <ShotDetail shot={shot} />;
		}
		case "episode":
			return <EpisodeDetail episodeId={selectedItemId} />;
		default:
			return null;
	}
}
