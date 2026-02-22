/**
 * PropertyPanel — detail view for the selected item in the episode tree.
 * Shows different fields based on selectedItemType (character/scene/shot/episode).
 */

import { useState, useCallback } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type {
	ScriptCharacter,
	ScriptScene,
	CharacterIdentityAnchors,
} from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
	CheckIcon,
	CopyIcon,
	FilmIcon,
	ImageIcon,
	MapPinIcon,
	PencilIcon,
	UserIcon,
	XIcon,
} from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";
import { ShotDetail } from "./shot-detail";

/** Reusable copy-to-clipboard button with feedback. */
function CopyButton({ getText }: { getText: () => string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		const text = getText();
		if (!text) return;
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<Button
			variant="text"
			size="sm"
			className="h-6 text-xs px-1.5"
			onClick={handleCopy}
		>
			{copied ? (
				<span className="text-[9px] text-green-600">Copied</span>
			) : (
				<CopyIcon className="h-3 w-3" />
			)}
		</Button>
	);
}

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

// ==================== Identity Anchors Display ====================

function IdentityAnchorsDisplay({
	anchors,
}: {
	anchors: CharacterIdentityAnchors;
}) {
	const layers: { label: string; entries: [string, string | undefined][] }[] = [
		{
			label: "Bone Structure",
			entries: [
				["Face", anchors.faceShape],
				["Jawline", anchors.jawline],
				["Cheekbones", anchors.cheekbones],
			],
		},
		{
			label: "Facial Features",
			entries: [
				["Eyes", anchors.eyeShape],
				["Eye Detail", anchors.eyeDetails],
				["Nose", anchors.noseShape],
				["Lips", anchors.lipShape],
			],
		},
		{
			label: "Color Anchors",
			entries: [
				["Iris", anchors.colorAnchors?.iris],
				["Hair", anchors.colorAnchors?.hair],
				["Skin", anchors.colorAnchors?.skin],
				["Lips", anchors.colorAnchors?.lips],
			],
		},
		{
			label: "Texture & Hair",
			entries: [
				["Skin Texture", anchors.skinTexture],
				["Hair Style", anchors.hairStyle],
				["Hairline", anchors.hairlineDetails],
			],
		},
	];

	const hasAnyData =
		anchors.uniqueMarks.length > 0 ||
		layers.some((l) => l.entries.some(([, v]) => v));

	if (!hasAnyData) return null;

	return (
		<CollapsibleSection title="Identity Anchors">
			{layers.map((layer) => {
				const filled = layer.entries.filter(([, v]) => v);
				if (filled.length === 0) return null;
				return (
					<div key={layer.label} className="space-y-0.5">
						<p className="text-[10px] font-medium text-muted-foreground">
							{layer.label}
						</p>
						<div className="flex flex-wrap gap-1">
							{filled.map(([key, val]) => (
								<Badge key={key} variant="outline" className="text-[10px] px-1">
									{key}: {val}
								</Badge>
							))}
						</div>
					</div>
				);
			})}
			{anchors.uniqueMarks.length > 0 && (
				<div className="space-y-0.5">
					<p className="text-[10px] font-medium text-muted-foreground">
						Identifying Marks
					</p>
					<div className="flex flex-wrap gap-1">
						{anchors.uniqueMarks.map((mark) => (
							<Badge
								key={mark}
								variant="secondary"
								className="text-[10px] px-1"
							>
								{mark}
							</Badge>
						))}
					</div>
				</div>
			)}
		</CollapsibleSection>
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
			visualPromptEn: char.visualPromptEn,
			visualPromptZh: char.visualPromptZh,
			traits: char.traits,
			relationships: char.relationships,
			notes: char.notes,
			tags: char.tags,
			referenceImages: char.referenceImages,
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
				<div className="space-y-1">
					<Label className="text-[10px]">Traits</Label>
					<Input
						className="h-7 text-xs"
						value={draft.traits ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, traits: e.target.value }))
						}
						placeholder="brave, cunning, loyal..."
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Relationships</Label>
					<Textarea
						className="text-xs min-h-[36px] resize-none"
						rows={1}
						value={draft.relationships ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, relationships: e.target.value }))
						}
						placeholder="Father of X, rival of Y..."
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Visual Prompt (EN)</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.visualPromptEn ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, visualPromptEn: e.target.value }))
						}
						placeholder="Detailed visual description for AI image generation..."
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Visual Prompt (ZH)</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.visualPromptZh ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, visualPromptZh: e.target.value }))
						}
						placeholder="中文视觉描述..."
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Notes</Label>
					<Textarea
						className="text-xs min-h-[36px] resize-none"
						rows={1}
						value={draft.notes ?? ""}
						onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-[10px]">Tags (comma-separated)</Label>
					<Input
						className="h-7 text-xs"
						value={(draft.tags ?? []).join(", ")}
						onChange={(e) =>
							setDraft((d) => ({
								...d,
								tags: e.target.value
									.split(",")
									.map((t) => t.trim())
									.filter(Boolean),
							}))
						}
						placeholder="protagonist, warrior, noble..."
					/>
				</div>

				{/* Reference Images */}
				<div className="space-y-1">
					<Label className="text-[10px]">Reference Images</Label>
					<div className="grid grid-cols-3 gap-1">
						{(draft.referenceImages ?? []).map((url, i) => (
							<div
								key={url}
								className="rounded border overflow-hidden aspect-square relative group"
							>
								<img
									src={url}
									alt={`Ref ${i + 1}`}
									className="w-full h-full object-cover"
								/>
								<button
									type="button"
									onClick={() =>
										setDraft((d) => ({
											...d,
											referenceImages: (d.referenceImages ?? []).filter(
												(_, idx) => idx !== i
											),
										}))
									}
									className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<XIcon className="h-2.5 w-2.5" />
								</button>
							</div>
						))}
					</div>
					<label className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] cursor-pointer hover:bg-muted transition-colors">
						<ImageIcon className="h-3 w-3" />
						Add Image
						<input
							type="file"
							accept="image/*"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (!file) return;
								const reader = new FileReader();
								reader.onload = () => {
									const dataUrl = reader.result as string;
									setDraft((d) => ({
										...d,
										referenceImages: [...(d.referenceImages ?? []), dataUrl],
									}));
								};
								reader.readAsDataURL(file);
								e.target.value = "";
							}}
						/>
					</label>
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
				<div className="flex items-center gap-0.5">
					<CopyButton
						getText={() =>
							JSON.stringify(
								{
									name: char.name,
									gender: char.gender,
									age: char.age,
									role: char.role,
									appearance: char.appearance,
									visualPromptEn: char.visualPromptEn,
									tags: char.tags,
								},
								null,
								2
							)
						}
					/>
					<Button
						variant="text"
						size="sm"
						className="h-6 text-xs px-1.5"
						onClick={startEdit}
					>
						<PencilIcon className="h-3 w-3" />
					</Button>
				</div>
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
			<FieldRow label="Traits" value={char.traits} />
			<FieldRow label="Relationships" value={char.relationships} />
			<FieldRow label="Visual Prompt (EN)" value={char.visualPromptEn} />
			<FieldRow label="Visual Prompt (ZH)" value={char.visualPromptZh} />
			<FieldRow label="Notes" value={char.notes} />
			{char.tags && char.tags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{char.tags.map((tag) => (
						<Badge key={tag} variant="secondary" className="text-[10px] px-1">
							{tag}
						</Badge>
					))}
				</div>
			)}

			{/* Negative Prompt */}
			{char.negativePrompt && (
				<CollapsibleSection title="Negative Prompt">
					{char.negativePrompt.avoid.length > 0 && (
						<div className="space-y-0.5">
							<p className="text-[10px] font-medium text-muted-foreground">
								Avoid
							</p>
							<div className="flex flex-wrap gap-1">
								{char.negativePrompt.avoid.map((item) => (
									<Badge
										key={item}
										variant="destructive"
										className="text-[10px] px-1"
									>
										{item}
									</Badge>
								))}
							</div>
						</div>
					)}
					{char.negativePrompt.styleExclusions &&
						char.negativePrompt.styleExclusions.length > 0 && (
							<div className="space-y-0.5">
								<p className="text-[10px] font-medium text-muted-foreground">
									Style Exclusions
								</p>
								<div className="flex flex-wrap gap-1">
									{char.negativePrompt.styleExclusions.map((item) => (
										<Badge
											key={item}
											variant="outline"
											className="text-[10px] px-1"
										>
											{item}
										</Badge>
									))}
								</div>
							</div>
						)}
				</CollapsibleSection>
			)}

			{/* Reference Images */}
			{char.referenceImages && char.referenceImages.length > 0 && (
				<CollapsibleSection title="Reference Images" icon={ImageIcon}>
					<div className="grid grid-cols-3 gap-1">
						{char.referenceImages.map((url, i) => (
							<div
								key={url}
								className="rounded border overflow-hidden aspect-square"
							>
								<img
									src={url}
									alt={`${char.name} ref ${i + 1}`}
									className="w-full h-full object-cover"
								/>
							</div>
						))}
					</div>
				</CollapsibleSection>
			)}

			{/* Identity Anchors */}
			{char.identityAnchors && (
				<IdentityAnchorsDisplay anchors={char.identityAnchors} />
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
				<div className="flex items-center gap-0.5">
					<CopyButton
						getText={() =>
							[
								`# ${scene.name || scene.location}`,
								scene.location && `Location: ${scene.location}`,
								scene.time && `Time: ${scene.time}`,
								scene.atmosphere && `Atmosphere: ${scene.atmosphere}`,
								scene.visualPrompt && `Visual Prompt: ${scene.visualPrompt}`,
								scene.architectureStyle &&
									`Architecture: ${scene.architectureStyle}`,
								scene.lightingDesign && `Lighting: ${scene.lightingDesign}`,
							]
								.filter(Boolean)
								.join("\n")
						}
					/>
					<Button
						variant="text"
						size="sm"
						className="h-6 text-xs px-1.5"
						onClick={startEdit}
					>
						<PencilIcon className="h-3 w-3" />
					</Button>
				</div>
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
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<FilmIcon className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-sm font-medium">{episode.title}</span>
				</div>
				<CopyButton
					getText={() =>
						[
							`# ${episode.title}`,
							episode.description && episode.description,
							`Scenes: ${epScenes.length}`,
							`Shots: ${epShots.length}`,
						]
							.filter(Boolean)
							.join("\n")
					}
				/>
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
