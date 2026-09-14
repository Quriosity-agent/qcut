import { useCallback, useId, useRef, useState } from "react";
import { AudioLines, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CloudTaskStatus } from "@/components/editor/cloud-task-status";
import {
	activateOnKeyboard,
	CaptionStyleSlider,
	ColorControl,
} from "@/components/captions/caption-style-controls";
import { useSpeechAvatarGeneration } from "@/hooks/use-speech-avatar-generation";
import {
	CAPTION_ANIMATION_TYPES,
	resolveSubtitleStyle,
} from "@/lib/captions/subtitle-style";
import { KARAOKE_MODES, type KaraokeMode } from "@/lib/captions/karaoke-types";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { CaptionStyleScope } from "@/stores/timeline/types";
import type { CaptionElement, SubtitleStyle } from "@/types/timeline";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { CaptionListTab } from "./caption-list-tab";
import { CaptionTextTab } from "./caption-text-tab";

const TAB_CLASS =
	"h-9 min-w-0 rounded-none border-b-2 border-transparent px-1 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-transparent";

const CAPTION_ANIMATION_LABEL_KEYS: Record<
	(typeof CAPTION_ANIMATION_TYPES)[number],
	TranslationKey
> = {
	none: "caption.animation.none",
	fade: "caption.animation.fade",
	"slide-up": "caption.animation.slideUp",
	"slide-left": "caption.animation.slideLeft",
};

const KARAOKE_MODE_LABEL_KEYS: Record<KaraokeMode, TranslationKey> = {
	none: "caption.karaoke.none",
	"word-highlight": "caption.karaoke.wordHighlight",
	"word-by-word": "caption.karaoke.wordByWord",
	karaoke: "caption.karaoke.fill",
	bounce: "caption.karaoke.bounce",
	typewriter: "caption.karaoke.typewriter",
	slam: "caption.karaoke.slam",
	spring: "caption.karaoke.spring",
	overlap: "caption.karaoke.overlap",
	expand: "caption.karaoke.expand",
	shine: "caption.karaoke.shine",
	pulse: "caption.karaoke.pulse",
	"fly-in": "caption.karaoke.flyIn",
	gather: "caption.karaoke.gather",
	flip: "caption.karaoke.flip",
	"blur-roll": "caption.karaoke.blurRoll",
	glitch: "caption.karaoke.glitch",
	mischief: "caption.karaoke.mischief",
};

function CaptionAnimationControls({
	style,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	style: SubtitleStyle;
	onChange: (updates: Partial<SubtitleStyle>) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-2">
				{CAPTION_ANIMATION_TYPES.map((animationType) => {
					const active = style.animationType === animationType;
					const action = () => onChange({ animationType });
					return (
						<Button
							key={animationType}
							type="button"
							variant={active ? "default" : "outline"}
							className="h-9 capitalize"
							onClick={action}
							onKeyDown={(event) => activateOnKeyboard({ event, action })}
							aria-pressed={active}
						>
							{t(CAPTION_ANIMATION_LABEL_KEYS[animationType])}
						</Button>
					);
				})}
			</div>
			{style.animationType !== "none" ? (
				<>
					<CaptionStyleSlider
						label={t("caption.animationDuration")}
						value={style.animationDuration}
						min={0.1}
						max={3}
						step={0.05}
						onChange={(animationDuration) => onChange({ animationDuration })}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
					<CaptionStyleSlider
						label={t("caption.animationDelay")}
						value={style.animationDelay}
						min={0}
						max={3}
						step={0.05}
						onChange={(animationDelay) => onChange({ animationDelay })}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
				</>
			) : null}
		</div>
	);
}

function KaraokeControls({
	style,
	onChange,
}: {
	style: SubtitleStyle;
	onChange: (updates: Partial<SubtitleStyle>) => void;
}) {
	const { t } = useTranslation();
	const karaokeMode = style.karaokeMode ?? "none";
	const karaokeModeId = useId();
	return (
		<div className="space-y-3 border-t border-border pt-4">
			<Label className="text-xs" htmlFor={karaokeModeId}>
				{t("caption.karaoke")}
			</Label>
			<Select
				value={karaokeMode}
				onValueChange={(value) =>
					onChange({ karaokeMode: value as KaraokeMode })
				}
			>
				<SelectTrigger
					id={karaokeModeId}
					className="h-8 text-xs"
					aria-label={t("caption.karaokeMode")}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{KARAOKE_MODES.map((mode) => (
						<SelectItem key={mode.value} value={mode.value}>
							{t(KARAOKE_MODE_LABEL_KEYS[mode.value])}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{karaokeMode !== "none" ? (
				<div className="grid grid-cols-2 gap-3">
					<ColorControl
						label={t("caption.highlight")}
						value={style.highlightColor ?? "#ffff00"}
						onChange={(highlightColor) => onChange({ highlightColor })}
					/>
					<ColorControl
						label={t("caption.upcoming")}
						value={style.upcomingColor ?? style.fontColor}
						onChange={(upcomingColor) => onChange({ upcomingColor })}
					/>
				</div>
			) : null}
		</div>
	);
}

export function CaptionProperties({
	element,
	trackId,
}: {
	element: CaptionElement;
	trackId: string;
}) {
	const { t } = useTranslation();
	const voiceModelId = useId();
	const portraitId = useId();
	const updateCaptionElement = useTimelineStore(
		(state) => state.updateCaptionElement
	);
	const applyCaptionStyle = useTimelineStore(
		(state) => state.applyCaptionStyle
	);
	const pushHistory = useTimelineStore((state) => state.pushHistory);
	// 文本、排列、气泡、花字应用到全部字幕: styling either edits this caption
	// or every caption in the project.
	const [applyToAll, setApplyToAll] = useState(false);
	const [selectedPresetId, setSelectedPresetId] = useState<string>();
	const interactionActive = useRef(false);
	const style = resolveSubtitleStyle(element.style);
	const scope: CaptionStyleScope = applyToAll ? "project" : "element";
	const generation = useSpeechAvatarGeneration({
		captionElementId: element.id,
		text: element.text,
		startTime: element.startTime,
		duration: Math.max(
			0.1,
			element.duration - element.trimStart - element.trimEnd
		),
	});
	const beginInteraction = useCallback(() => {
		if (interactionActive.current) return;
		interactionActive.current = true;
		pushHistory();
	}, [pushHistory]);
	const endInteraction = useCallback(() => {
		interactionActive.current = false;
	}, []);
	const updateStyle = useCallback(
		(updates: Partial<SubtitleStyle>) => {
			applyCaptionStyle({
				trackId,
				elementId: element.id,
				style: updates,
				scope,
				pushHistory: !interactionActive.current,
			});
		},
		[applyCaptionStyle, element.id, scope, trackId]
	);

	return (
		<div className="pb-4" data-testid="caption-properties">
			<Tabs defaultValue="captions">
				<TabsList className="sticky top-0 z-10 grid h-9 w-full grid-cols-5 rounded-none border-b border-border bg-panel p-0">
					<TabsTrigger
						value="captions"
						className={TAB_CLASS}
						data-testid="caption-list-tab-trigger"
					>
						{t("caption.tab.captions")}
					</TabsTrigger>
					<TabsTrigger
						value="text"
						className={TAB_CLASS}
						data-testid="caption-text-tab-trigger"
					>
						{t("caption.tab.text")}
					</TabsTrigger>
					<TabsTrigger value="motion" className={TAB_CLASS}>
						{t("caption.tab.motion")}
					</TabsTrigger>
					<TabsTrigger value="voice" className={TAB_CLASS}>
						{t("caption.tab.voice")}
					</TabsTrigger>
					<TabsTrigger
						value="avatar"
						className={TAB_CLASS}
						data-testid="caption-avatar-tab"
					>
						{t("caption.tab.avatar")}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="captions" className="mt-4 px-4">
					<CaptionListTab trackId={trackId} activeElementId={element.id} />
				</TabsContent>
				<TabsContent value="text" className="mt-4 px-4">
					<CaptionTextTab
						text={element.text}
						onTextChange={(text) =>
							updateCaptionElement(trackId, element.id, { text })
						}
						style={style}
						applyToAll={applyToAll}
						onApplyToAllChange={setApplyToAll}
						onStyleChange={updateStyle}
						onInteractionStart={beginInteraction}
						onInteractionEnd={endInteraction}
						selectedPresetId={selectedPresetId}
						onSelectPreset={(preset) => {
							setSelectedPresetId(preset.id);
							updateStyle(preset.style);
						}}
					/>
				</TabsContent>
				<TabsContent value="motion" className="mt-4 space-y-4 px-4">
					<CaptionAnimationControls
						style={style}
						onChange={updateStyle}
						onInteractionStart={beginInteraction}
						onInteractionEnd={endInteraction}
					/>
					<KaraokeControls style={style} onChange={updateStyle} />
				</TabsContent>
				<TabsContent value="voice" className="mt-4 space-y-4 px-4">
					<div className="space-y-1.5">
						<Label className="text-xs" htmlFor={voiceModelId}>
							{t("caption.voiceModel")}
						</Label>
						<Select
							value={generation.speechModel}
							onValueChange={generation.setSpeechModel}
						>
							<SelectTrigger
								id={voiceModelId}
								className="h-8 text-xs"
								aria-label={t("caption.voiceModel")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="chatterbox_tts">Chatterbox</SelectItem>
								<SelectItem value="chatterbox_tts_turbo">
									Chatterbox Turbo
								</SelectItem>
								<SelectItem value="elevenlabs_v3">ElevenLabs v3</SelectItem>
								<SelectItem value="qwen3_tts">Qwen3 TTS</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Button
						type="button"
						className="w-full"
						disabled={!generation.canGenerateSpeech}
						onClick={generation.createSpeech}
						onKeyDown={(event) =>
							activateOnKeyboard({
								event,
								action: generation.createSpeech,
							})
						}
					>
						{generation.isGenerating &&
						generation.generationKind === "speech" ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<AudioLines className="size-4" />
						)}
						{generation.isGenerating && generation.generationKind === "speech"
							? (generation.progress?.message ?? t("caption.generatingSpeech"))
							: t("caption.generateSpeech")}
					</Button>
				</TabsContent>
				<TabsContent value="avatar" className="mt-4 space-y-4 px-4">
					<div className="space-y-1.5">
						<Label className="text-xs" htmlFor={portraitId}>
							{t("caption.portrait")}
						</Label>
						<Select
							value={generation.avatarImageId}
							onValueChange={generation.setAvatarImageId}
						>
							<SelectTrigger
								id={portraitId}
								className="h-8 text-xs"
								aria-label={t("caption.portrait")}
								data-testid="caption-avatar-portrait"
							>
								<SelectValue placeholder={t("caption.chooseImage")} />
							</SelectTrigger>
							<SelectContent>
								{generation.avatarImages.map((image) => (
									<SelectItem key={image.id} value={image.id}>
										{image.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Button
						type="button"
						className="w-full"
						disabled={!generation.canGenerateAlignedPair}
						onClick={() => void generation.createAlignedPair()}
						onKeyDown={(event) =>
							activateOnKeyboard({
								event,
								action: () => void generation.createAlignedPair(),
							})
						}
						data-testid="generate-aligned-avatar"
					>
						{generation.isGenerating && generation.generationKind === "pair" ? (
							<Loader2 className="size-4 animate-spin">
								<title>{t("caption.generatingPair")}</title>
							</Loader2>
						) : (
							<Sparkles className="size-4">
								<title>{t("caption.generatePair")}</title>
							</Sparkles>
						)}
						{generation.isGenerating && generation.generationKind === "pair"
							? (generation.progress?.message ?? t("caption.generatingPair"))
							: t("caption.generatePair")}
					</Button>
					<CloudTaskStatus
						taskId={generation.alignedTaskId}
						onCancel={generation.cancelAlignedPair}
						onRetry={generation.retryAlignedPair}
					/>
					<div className="border-t border-border pt-3">
						<p className="mb-2 text-[10px] text-muted-foreground">
							{t("caption.videoOnly")}
						</p>
						<Button
							type="button"
							className="w-full"
							disabled={!generation.canGenerateAvatar}
							onClick={generation.createAvatar}
							onKeyDown={(event) =>
								activateOnKeyboard({
									event,
									action: generation.createAvatar,
								})
							}
						>
							{generation.isGenerating &&
							generation.generationKind === "avatar" ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Sparkles className="size-4" />
							)}
							{generation.isGenerating && generation.generationKind === "avatar"
								? (generation.progress?.message ??
									t("caption.generatingAvatar"))
								: t("caption.generateAvatar")}
						</Button>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
