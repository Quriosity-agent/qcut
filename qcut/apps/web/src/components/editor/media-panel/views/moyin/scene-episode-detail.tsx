/**
 * SceneDetail & EpisodeDetail — extracted from property-panel.tsx
 * to keep files under 800 lines.
 */

import { useState, useCallback } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type { ScriptScene } from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
	CheckIcon,
	CopyIcon,
	FilmIcon,
	MapPinIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";

// ==================== Shared Helpers ====================

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
			aria-label="Copy to clipboard"
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

// ==================== Scene Detail ====================

export function SceneDetail({ scene }: { scene: ScriptScene }) {
	const updateScene = useMoyinStore((s) => s.updateScene);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Partial<ScriptScene>>({});
	const [keyPropsText, setKeyPropsText] = useState("");

	const startEdit = useCallback(() => {
		setDraft({
			name: scene.name,
			location: scene.location,
			time: scene.time,
			atmosphere: scene.atmosphere,
			visualPrompt: scene.visualPrompt,
			visualPromptEn: scene.visualPromptEn,
			architectureStyle: scene.architectureStyle,
			lightingDesign: scene.lightingDesign,
			colorPalette: scene.colorPalette,
			spatialLayout: scene.spatialLayout,
			eraDetails: scene.eraDetails,
		});
		setKeyPropsText(scene.keyProps?.join(", ") || "");
		setEditing(true);
	}, [scene]);

	const save = useCallback(() => {
		const updates = {
			...draft,
			keyProps: keyPropsText
				? keyPropsText
						.split(",")
						.map((p) => p.trim())
						.filter(Boolean)
				: undefined,
		};
		updateScene(scene.id, updates);
		setEditing(false);
	}, [scene.id, draft, keyPropsText, updateScene]);

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
					<Label className="text-[10px]">Visual Prompt</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.visualPrompt ?? ""}
						onChange={(e) =>
							setDraft((d) => ({ ...d, visualPrompt: e.target.value }))
						}
					/>
				</div>
				<CollapsibleSection title="Art Direction" defaultOpen={false}>
					<div className="space-y-2">
						<div className="space-y-1">
							<Label className="text-[10px]">Visual Prompt (EN)</Label>
							<Textarea
								className="text-xs min-h-[48px] resize-none"
								rows={2}
								value={draft.visualPromptEn ?? ""}
								onChange={(e) =>
									setDraft((d) => ({
										...d,
										visualPromptEn: e.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Architecture Style</Label>
							<Input
								className="h-7 text-xs"
								value={draft.architectureStyle ?? ""}
								onChange={(e) =>
									setDraft((d) => ({
										...d,
										architectureStyle: e.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Lighting Design</Label>
							<Textarea
								className="text-xs min-h-[36px] resize-none"
								rows={2}
								value={draft.lightingDesign ?? ""}
								onChange={(e) =>
									setDraft((d) => ({
										...d,
										lightingDesign: e.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Color Palette</Label>
							<Input
								className="h-7 text-xs"
								placeholder="comma-separated colors"
								value={draft.colorPalette ?? ""}
								onChange={(e) =>
									setDraft((d) => ({
										...d,
										colorPalette: e.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Key Props</Label>
							<Input
								className="h-7 text-xs"
								placeholder="comma-separated props"
								value={keyPropsText}
								onChange={(e) => setKeyPropsText(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Spatial Layout</Label>
							<Textarea
								className="text-xs min-h-[36px] resize-none"
								rows={2}
								value={draft.spatialLayout ?? ""}
								onChange={(e) =>
									setDraft((d) => ({
										...d,
										spatialLayout: e.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Era Details</Label>
							<Input
								className="h-7 text-xs"
								value={draft.eraDetails ?? ""}
								onChange={(e) =>
									setDraft((d) => ({
										...d,
										eraDetails: e.target.value,
									}))
								}
							/>
						</div>
					</div>
				</CollapsibleSection>
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
						aria-label="Edit scene"
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
			<FieldRow label="Key Props" value={scene.keyProps?.join(", ")} />
			<FieldRow label="Spatial Layout" value={scene.spatialLayout} />
			<FieldRow label="Era Details" value={scene.eraDetails} />
			<FieldRow label="Visual Prompt (EN)" value={scene.visualPromptEn} />
		</div>
	);
}

// ==================== Episode Detail ====================

export function EpisodeDetail({ episodeId }: { episodeId: string }) {
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
