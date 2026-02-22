import { useState, useCallback } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type { Shot } from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CheckIcon,
	CopyIcon,
	GripVerticalIcon,
	ImageIcon,
	Loader2,
	PencilIcon,
	VideoIcon,
	XIcon,
} from "lucide-react";
import { PromptEditor } from "./prompt-editor";
import {
	ShotSizeSelector,
	DurationSelector,
	EmotionTagSelector,
	SoundDesignInput,
} from "./shot-selectors";
import {
	LightingSelector,
	FocusSelector,
	RigSelector,
	AtmosphereSelector,
	SpeedSelector,
	AngleSelector,
	FocalLengthSelector,
	TechniqueSelector,
} from "./cinema-selectors";
import { CollapsibleSection } from "./collapsible-section";
import { MediaPreviewModal } from "./media-preview-modal";
import { isModerationError } from "@/stores/moyin-shot-generation";

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

function ModerationErrorDisplay({
	error,
	onEditPrompt,
	onRetry,
}: {
	error: string;
	onEditPrompt: () => void;
	onRetry?: () => void;
}) {
	if (isModerationError(error)) {
		return (
			<div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-2 text-[10px] text-yellow-700 dark:text-yellow-400 space-y-1">
				<p className="font-medium">Content Moderation</p>
				<p>
					This prompt was flagged by the safety filter. Try editing the prompt
					to adjust the content.
				</p>
				<button
					type="button"
					onClick={onEditPrompt}
					className="text-[10px] underline hover:no-underline"
				>
					Edit Prompt
				</button>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-1.5 text-[10px] text-destructive">
			<span className="flex-1 truncate">{error}</span>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="shrink-0 underline hover:no-underline text-destructive"
				>
					Retry
				</button>
			)}
		</div>
	);
}

const NARRATIVE_FUNCTIONS = [
	"exposition",
	"escalation",
	"climax",
	"turning-point",
	"transition",
	"denouement",
] as const;

export function ShotDetail({ shot }: { shot: Shot }) {
	const updateShot = useMoyinStore((s) => s.updateShot);
	const generateShotImage = useMoyinStore((s) => s.generateShotImage);
	const generateShotVideo = useMoyinStore((s) => s.generateShotVideo);
	const generateEndFrameImage = useMoyinStore((s) => s.generateEndFrameImage);
	const allShots = useMoyinStore((s) => s.shots);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);
	const shotIdx = allShots.findIndex((s) => s.id === shot.id);
	const prevShot = shotIdx > 0 ? allShots[shotIdx - 1] : null;
	const nextShot = shotIdx < allShots.length - 1 ? allShots[shotIdx + 1] : null;
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Partial<Shot>>({});
	const [preview, setPreview] = useState<{
		url: string;
		type: "image" | "video";
	} | null>(null);

	const isImageGenerating = shot.imageStatus === "generating";
	const isVideoGenerating = shot.videoStatus === "generating";
	const isEndFrameGenerating = shot.endFrameImageStatus === "generating";

	const handleDragStart = useCallback(
		(e: React.DragEvent, type: "image" | "video") => {
			const url = type === "image" ? shot.imageUrl : shot.videoUrl;
			if (!url) return;
			e.dataTransfer.setData(
				"application/json",
				JSON.stringify({
					id: shot.id,
					type,
					name: `Shot ${shot.index + 1}`,
					url,
					duration: shot.duration || 5,
				})
			);
		},
		[shot]
	);

	const startEdit = useCallback(() => {
		setDraft({
			// Core
			actionSummary: shot.actionSummary,
			shotSize: shot.shotSize,
			cameraMovement: shot.cameraMovement,
			dialogue: shot.dialogue,
			duration: shot.duration,
			// Prompts
			imagePrompt: shot.imagePrompt,
			imagePromptZh: shot.imagePromptZh,
			videoPrompt: shot.videoPrompt,
			videoPromptZh: shot.videoPromptZh,
			endFramePrompt: shot.endFramePrompt,
			endFramePromptZh: shot.endFramePromptZh,
			needsEndFrame: shot.needsEndFrame,
			// Emotion & Sound
			emotionTags: shot.emotionTags,
			ambientSound: shot.ambientSound,
			soundEffect: shot.soundEffect,
			bgm: shot.bgm,
			audioEnabled: shot.audioEnabled,
			// Lighting (Gaffer)
			lightingStyle: shot.lightingStyle,
			lightingDirection: shot.lightingDirection,
			colorTemperature: shot.colorTemperature,
			lightingNotes: shot.lightingNotes,
			// Focus
			depthOfField: shot.depthOfField,
			focusTarget: shot.focusTarget,
			focusTransition: shot.focusTransition,
			// Camera Rig
			cameraRig: shot.cameraRig,
			movementSpeed: shot.movementSpeed,
			// Atmosphere
			atmosphericEffects: shot.atmosphericEffects,
			effectIntensity: shot.effectIntensity,
			// Speed
			playbackSpeed: shot.playbackSpeed,
			// Camera
			cameraAngle: shot.cameraAngle,
			focalLength: shot.focalLength,
			photographyTechnique: shot.photographyTechnique,
			// Narrative
			narrativeFunction: shot.narrativeFunction,
			shotPurpose: shot.shotPurpose,
			visualFocus: shot.visualFocus,
			cameraPosition: shot.cameraPosition,
			characterBlocking: shot.characterBlocking,
			rhythm: shot.rhythm,
		});
		setEditing(true);
	}, [shot]);
	const save = useCallback(() => {
		updateShot(shot.id, draft);
		setEditing(false);
	}, [shot.id, draft, updateShot]);
	const setField = useCallback(
		(updates: Partial<Shot>) => setDraft((d) => ({ ...d, ...updates })),
		[]
	);

	if (editing) {
		return (
			<div className="space-y-2">
				{/* Core fields */}
				<div className="space-y-1">
					<Label className="text-[10px]">Action Summary</Label>
					<Textarea
						className="text-xs min-h-[48px] resize-none"
						rows={2}
						value={draft.actionSummary ?? ""}
						onChange={(e) => setField({ actionSummary: e.target.value })}
					/>
				</div>
				<ShotSizeSelector
					value={draft.shotSize}
					onChange={(v) => setField({ shotSize: v })}
				/>
				<div className="space-y-1">
					<Label className="text-[10px]">Camera Movement</Label>
					<Input
						className="h-7 text-xs"
						value={draft.cameraMovement ?? ""}
						onChange={(e) => setField({ cameraMovement: e.target.value })}
					/>
				</div>
				<DurationSelector
					value={draft.duration}
					onChange={(v) => setField({ duration: v })}
				/>
				<div className="space-y-1">
					<Label className="text-[10px]">Dialogue</Label>
					<Textarea
						className="text-xs min-h-[36px] resize-none"
						rows={1}
						value={draft.dialogue ?? ""}
						onChange={(e) => setField({ dialogue: e.target.value })}
					/>
				</div>

				{/* Lighting (Gaffer) */}
				<CollapsibleSection title="Lighting">
					<LightingSelector
						lightingStyle={draft.lightingStyle}
						lightingDirection={draft.lightingDirection}
						colorTemperature={draft.colorTemperature}
						onStyleChange={(v) => setField({ lightingStyle: v })}
						onDirectionChange={(v) => setField({ lightingDirection: v })}
						onTempChange={(v) => setField({ colorTemperature: v })}
					/>
					<div className="space-y-1">
						<Label className="text-[10px]">Lighting Notes</Label>
						<Input
							className="h-7 text-xs"
							value={draft.lightingNotes ?? ""}
							onChange={(e) => setField({ lightingNotes: e.target.value })}
						/>
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Focus">
					<FocusSelector
						depthOfField={draft.depthOfField}
						focusTransition={draft.focusTransition}
						onDofChange={(v) => setField({ depthOfField: v })}
						onTransitionChange={(v) => setField({ focusTransition: v })}
					/>
					<div className="space-y-1">
						<Label className="text-[10px]">Focus Target</Label>
						<Input
							className="h-7 text-xs"
							value={draft.focusTarget ?? ""}
							onChange={(e) => setField({ focusTarget: e.target.value })}
							placeholder="e.g. character face, envelope on table"
						/>
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Camera Rig">
					<RigSelector
						cameraRig={draft.cameraRig}
						movementSpeed={draft.movementSpeed}
						onRigChange={(v) => setField({ cameraRig: v })}
						onSpeedChange={(v) => setField({ movementSpeed: v })}
					/>
				</CollapsibleSection>
				<CollapsibleSection title="Camera">
					<AngleSelector
						cameraAngle={draft.cameraAngle}
						onChange={(v) => setField({ cameraAngle: v })}
					/>
					<FocalLengthSelector
						focalLength={draft.focalLength}
						onChange={(v) => setField({ focalLength: v })}
					/>
					<TechniqueSelector
						photographyTechnique={draft.photographyTechnique}
						onChange={(v) => setField({ photographyTechnique: v })}
					/>
				</CollapsibleSection>
				<CollapsibleSection title="Atmosphere">
					<AtmosphereSelector
						atmosphericEffects={draft.atmosphericEffects}
						effectIntensity={draft.effectIntensity}
						onEffectsChange={(v) => setField({ atmosphericEffects: v })}
						onIntensityChange={(v) => setField({ effectIntensity: v })}
					/>
					<SpeedSelector
						playbackSpeed={draft.playbackSpeed}
						onChange={(v) => setField({ playbackSpeed: v })}
					/>
				</CollapsibleSection>
				<CollapsibleSection title="Emotion & Sound" defaultOpen>
					<EmotionTagSelector
						value={draft.emotionTags}
						onChange={(v) => setField({ emotionTags: v })}
					/>
					<SoundDesignInput
						ambientSound={draft.ambientSound}
						soundEffect={draft.soundEffect}
						bgm={draft.bgm}
						audioEnabled={draft.audioEnabled}
						onAmbientChange={(v) => setField({ ambientSound: v })}
						onSfxChange={(v) => setField({ soundEffect: v })}
						onBgmChange={(v) => setField({ bgm: v })}
						onAudioEnabledChange={(v) => setField({ audioEnabled: v })}
					/>
				</CollapsibleSection>
				<CollapsibleSection title="Narrative">
					<div className="space-y-1">
						<Label className="text-[10px]">Narrative Function</Label>
						<div className="flex flex-wrap gap-1">
							{NARRATIVE_FUNCTIONS.map((fn) => (
								<button
									key={fn}
									type="button"
									onClick={() => setField({ narrativeFunction: fn })}
									className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
										draft.narrativeFunction === fn
											? "bg-primary text-primary-foreground"
											: "bg-muted text-muted-foreground hover:bg-muted/80"
									}`}
								>
									{fn}
								</button>
							))}
						</div>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Shot Purpose</Label>
						<Textarea
							className="text-xs min-h-[32px] resize-none"
							rows={1}
							value={draft.shotPurpose ?? ""}
							onChange={(e) => setField({ shotPurpose: e.target.value })}
							placeholder="Why this shot?"
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Visual Focus</Label>
						<Input
							className="h-7 text-xs"
							value={draft.visualFocus ?? ""}
							onChange={(e) => setField({ visualFocus: e.target.value })}
							placeholder="What should viewers look at first?"
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Character Blocking</Label>
						<Input
							className="h-7 text-xs"
							value={draft.characterBlocking ?? ""}
							onChange={(e) => setField({ characterBlocking: e.target.value })}
							placeholder="Actor positioning in frame"
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Rhythm</Label>
						<Input
							className="h-7 text-xs"
							value={draft.rhythm ?? ""}
							onChange={(e) => setField({ rhythm: e.target.value })}
							placeholder="Pacing feel of this shot"
						/>
					</div>
				</CollapsibleSection>

				{/* Prompts */}
				<PromptEditor draft={draft} onUpdate={setField} />

				{/* Save / Cancel */}
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

	// ==================== Read Mode ====================
	return (
		<div className="space-y-2">
			{preview && (
				<MediaPreviewModal
					url={preview.url}
					type={preview.type}
					title={`Shot ${shot.index + 1}`}
					onClose={() => setPreview(null)}
				/>
			)}

			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => prevShot && setSelectedItem(prevShot.id, "shot")}
						disabled={!prevShot}
						className="p-0.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
						aria-label="Previous shot"
					>
						<ArrowLeftIcon className="h-3 w-3" />
					</button>
					<VideoIcon className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-sm font-medium">
						Shot {String(shot.index + 1).padStart(2, "0")}
					</span>
					<span className="text-[9px] text-muted-foreground">
						/{allShots.length}
					</span>
					<button
						type="button"
						onClick={() => nextShot && setSelectedItem(nextShot.id, "shot")}
						disabled={!nextShot}
						className="p-0.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
						aria-label="Next shot"
					>
						<ArrowRightIcon className="h-3 w-3" />
					</button>
					{shot.shotSize && (
						<Badge variant="outline" className="text-[10px] font-mono">
							{shot.shotSize}
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-0.5">
					<CopyButton
						getText={() =>
							[
								`Shot ${shot.index + 1}`,
								shot.actionSummary && `Action: ${shot.actionSummary}`,
								shot.shotSize && `Shot Size: ${shot.shotSize}`,
								shot.cameraMovement && `Camera: ${shot.cameraMovement}`,
								shot.dialogue && `Dialogue: ${shot.dialogue}`,
								shot.imagePrompt && `Image Prompt: ${shot.imagePrompt}`,
								shot.videoPrompt && `Video Prompt: ${shot.videoPrompt}`,
								shot.characterNames?.length &&
									`Characters: ${shot.characterNames.join(", ")}`,
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

			{/* Core fields */}
			<FieldRow label="Action" value={shot.actionSummary} />
			<FieldRow label="Camera" value={shot.cameraMovement} />
			<FieldRow label="Dialogue" value={shot.dialogue} />
			<ShotSizeSelector value={shot.shotSize} onChange={() => {}} readOnly />
			<DurationSelector value={shot.duration} onChange={() => {}} readOnly />

			{/* Lighting */}
			<LightingSelector
				lightingStyle={shot.lightingStyle}
				lightingDirection={shot.lightingDirection}
				colorTemperature={shot.colorTemperature}
				onStyleChange={() => {}}
				onDirectionChange={() => {}}
				onTempChange={() => {}}
				readOnly
			/>
			<FieldRow label="Lighting Notes" value={shot.lightingNotes} />

			{/* Focus */}
			<FocusSelector
				depthOfField={shot.depthOfField}
				focusTransition={shot.focusTransition}
				onDofChange={() => {}}
				onTransitionChange={() => {}}
				readOnly
			/>
			<FieldRow label="Focus Target" value={shot.focusTarget} />

			{/* Camera Rig */}
			<RigSelector
				cameraRig={shot.cameraRig}
				movementSpeed={shot.movementSpeed}
				onRigChange={() => {}}
				onSpeedChange={() => {}}
				readOnly
			/>

			{/* Camera Angle / Focal / Technique */}
			<AngleSelector
				cameraAngle={shot.cameraAngle}
				onChange={() => {}}
				readOnly
			/>
			<FocalLengthSelector
				focalLength={shot.focalLength}
				onChange={() => {}}
				readOnly
			/>
			<TechniqueSelector
				photographyTechnique={shot.photographyTechnique}
				onChange={() => {}}
				readOnly
			/>

			{/* Atmosphere */}
			<AtmosphereSelector
				atmosphericEffects={shot.atmosphericEffects}
				effectIntensity={shot.effectIntensity}
				onEffectsChange={() => {}}
				onIntensityChange={() => {}}
				readOnly
			/>
			<SpeedSelector
				playbackSpeed={shot.playbackSpeed}
				onChange={() => {}}
				readOnly
			/>

			{/* Emotion & Sound */}
			<EmotionTagSelector
				value={shot.emotionTags}
				onChange={() => {}}
				readOnly
			/>
			<SoundDesignInput
				ambientSound={shot.ambientSound}
				soundEffect={shot.soundEffect}
				bgm={shot.bgm}
				audioEnabled={shot.audioEnabled}
				onAmbientChange={() => {}}
				onSfxChange={() => {}}
				readOnly
			/>

			{/* Narrative */}
			{shot.narrativeFunction && (
				<div className="space-y-0.5">
					<p className="text-[10px] font-medium text-muted-foreground">
						Narrative Function
					</p>
					<Badge variant="outline" className="text-[10px]">
						{shot.narrativeFunction}
					</Badge>
				</div>
			)}
			<FieldRow label="Shot Purpose" value={shot.shotPurpose} />
			<FieldRow label="Visual Focus" value={shot.visualFocus} />
			<FieldRow label="Blocking" value={shot.characterBlocking} />
			<FieldRow label="Rhythm" value={shot.rhythm} />

			{/* Prompts */}
			<PromptEditor draft={shot} onUpdate={() => {}} readOnly />

			{/* Image preview */}
			{shot.imageUrl && (
				<div
					className="rounded border overflow-hidden cursor-pointer relative group"
					draggable
					onDragStart={(e) => handleDragStart(e, "image")}
					onClick={() => setPreview({ url: shot.imageUrl!, type: "image" })}
					onKeyDown={() => {}}
					role="button"
					tabIndex={0}
				>
					<img
						src={shot.imageUrl}
						alt={`Shot ${shot.index + 1}`}
						className="w-full h-auto"
					/>
					<div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
						<GripVerticalIcon className="h-4 w-4 text-white drop-shadow" />
					</div>
				</div>
			)}

			{/* Characters */}
			{shot.characterNames && shot.characterNames.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{shot.characterNames.map((name) => (
						<Badge key={name} variant="secondary" className="text-[10px] px-1">
							{name}
						</Badge>
					))}
				</div>
			)}

			{/* End frame image */}
			{shot.endFrameImageUrl && (
				<div className="space-y-0.5">
					<p className="text-[10px] font-medium text-muted-foreground">
						End Frame
						{shot.endFrameSource && (
							<Badge variant="outline" className="text-[9px] ml-1 px-1 py-0">
								{shot.endFrameSource}
							</Badge>
						)}
					</p>
					<div
						className="rounded border overflow-hidden cursor-pointer"
						onClick={() =>
							setPreview({ url: shot.endFrameImageUrl!, type: "image" })
						}
						onKeyDown={() => {}}
						role="button"
						tabIndex={0}
					>
						<img
							src={shot.endFrameImageUrl}
							alt={`Shot ${shot.index + 1} end frame`}
							className="w-full h-auto"
						/>
					</div>
				</div>
			)}

			{/* Generation buttons */}
			<div className="space-y-1.5 border-t pt-2">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					Generate
				</p>
				{shot.imageError && (
					<ModerationErrorDisplay
						error={shot.imageError}
						onEditPrompt={() => startEdit()}
						onRetry={() => generateShotImage(shot.id)}
					/>
				)}
				{shot.videoError && (
					<ModerationErrorDisplay
						error={shot.videoError}
						onEditPrompt={() => startEdit()}
						onRetry={() => generateShotVideo(shot.id)}
					/>
				)}
				{shot.endFrameImageError && (
					<ModerationErrorDisplay
						error={shot.endFrameImageError}
						onEditPrompt={() => startEdit()}
						onRetry={() => generateEndFrameImage(shot.id)}
					/>
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
				{isImageGenerating && shot.imageProgress > 0 && (
					<div className="flex items-center gap-1.5">
						<Progress value={shot.imageProgress} className="flex-1 h-1.5" />
						<span className="text-[9px] text-muted-foreground w-7 text-right">
							{shot.imageProgress}%
						</span>
					</div>
				)}
				{isVideoGenerating && shot.videoProgress > 0 && (
					<div className="flex items-center gap-1.5">
						<Progress value={shot.videoProgress} className="flex-1 h-1.5" />
						<span className="text-[9px] text-muted-foreground w-7 text-right">
							{shot.videoProgress}%
						</span>
					</div>
				)}
				{(shot.needsEndFrame || shot.endFramePrompt) && (
					<Button
						size="sm"
						variant={
							shot.endFrameImageStatus === "completed" ? "outline" : "default"
						}
						className="w-full h-7 text-xs"
						onClick={() => generateEndFrameImage(shot.id)}
						disabled={isEndFrameGenerating}
					>
						{isEndFrameGenerating ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<ImageIcon className="mr-1 h-3 w-3" />
						)}
						{shot.endFrameImageStatus === "completed"
							? "Regenerate End Frame"
							: "End Frame"}
					</Button>
				)}
			</div>

			{/* Video preview */}
			{shot.videoUrl && (
				<div
					className="rounded border overflow-hidden relative group"
					draggable
					onDragStart={(e) => handleDragStart(e, "video")}
				>
					<video
						src={shot.videoUrl}
						controls
						className="w-full h-auto"
						aria-label={`Shot ${shot.index + 1} video`}
					/>
					<div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
						<GripVerticalIcon className="h-4 w-4 text-white drop-shadow" />
					</div>
				</div>
			)}
		</div>
	);
}
