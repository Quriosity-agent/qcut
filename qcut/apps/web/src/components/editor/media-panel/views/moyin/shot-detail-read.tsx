/**
 * ShotDetailRead — Rich read-mode display for shot details.
 * Matches the moyin-creator layout: images → prompts → audio → camera params.
 */

import { useState } from "react";
import type { Shot } from "@/types/moyin-script";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	CameraIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ClockIcon,
	CopyIcon,
	CrosshairIcon,
	EyeIcon,
	FilmIcon,
	ImageIcon,
	MicIcon,
	MusicIcon,
	SpeechIcon,
	Volume2Icon,
	ZapIcon,
} from "lucide-react";

// ── Label maps for enum display ──────────────────────────────────

const ANGLE_LABELS: Record<string, string> = {
	"eye-level": "Eye Level",
	"high-angle": "High",
	"low-angle": "Low",
	"birds-eye": "Bird's Eye",
	"worms-eye": "Worm's Eye",
	"over-shoulder": "OTS",
	"side-angle": "Side",
	"dutch-angle": "Dutch",
	"third-person": "3rd Person",
};

const TECHNIQUE_LABELS: Record<string, string> = {
	"long-exposure": "Long Exposure",
	"double-exposure": "Double Exp",
	macro: "Macro",
	"tilt-shift": "Tilt Shift",
	"high-speed": "High Speed",
	bokeh: "Bokeh",
	reflection: "Reflection",
	"silhouette-technique": "Silhouette",
};

const RIG_LABELS: Record<string, string> = {
	tripod: "Tripod",
	handheld: "Handheld",
	steadicam: "Steadicam",
	dolly: "Dolly",
	crane: "Crane",
	drone: "Drone",
	shoulder: "Shoulder",
	slider: "Slider",
};

const SPEED_LABELS: Record<string, string> = {
	"slow-motion-4x": "Slow 4x",
	"slow-motion-2x": "Slow 2x",
	normal: "Normal",
	"fast-2x": "Fast 2x",
	timelapse: "Timelapse",
};

// ── Pill badge helper ────────────────────────────────────────────

type PillColor = "default" | "blue" | "green" | "orange" | "purple";

const PILL_COLORS: Record<PillColor, string> = {
	default: "bg-muted/60 text-muted-foreground",
	blue: "bg-blue-500/15 text-blue-400",
	green: "bg-green-500/15 text-green-400",
	orange: "bg-orange-500/15 text-orange-400",
	purple: "bg-purple-500/15 text-purple-400",
};

function ParamPill({
	icon: Icon,
	label,
	value,
	color = "default",
}: {
	icon?: React.ElementType;
	label: string;
	value: string | undefined;
	color?: PillColor;
}) {
	return (
		<div
			className={cn(
				"inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium",
				value ? PILL_COLORS[color] : "bg-muted/40 text-muted-foreground/40",
			)}
			title={label}
		>
			{Icon && <Icon className="h-2.5 w-2.5 shrink-0" />}
			<span>{value || "\u2014"}</span>
		</div>
	);
}

// ── Audio row helper ─────────────────────────────────────────────

function AudioRow({
	icon: Icon,
	label,
	value,
	color,
}: {
	icon: React.ElementType;
	label: string;
	value: string | undefined;
	color: string;
}) {
	return (
		<div className="flex items-start gap-2 text-[10px]">
			<span
				className={cn(
					"inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium shrink-0",
					color,
				)}
			>
				<Icon className="h-2.5 w-2.5" />
				{label}
			</span>
			<span
				className={cn(
					"pt-0.5",
					value ? "text-foreground" : "text-muted-foreground/40",
				)}
			>
				{value || "\u2014"}
			</span>
		</div>
	);
}

// ── Prompt section helper ────────────────────────────────────────

interface PromptBlockProps {
	label: string;
	sublabel?: string;
	color: string;
	dotColor: string;
	content?: string;
	contentZh?: string;
}

function PromptBlock({
	label,
	sublabel,
	color,
	dotColor,
	content,
	contentZh,
}: PromptBlockProps) {
	const [expanded, setExpanded] = useState(true);
	const [copied, setCopied] = useState(false);
	const displayText = content || contentZh;

	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		const text = [content && `EN: ${content}`, contentZh && `ZH: ${contentZh}`]
			.filter(Boolean)
			.join("\n");
		if (text) {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	};

	return (
		<div className="border-l-2 pl-2" style={{ borderColor: dotColor }}>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-1.5 w-full text-left group"
			>
				{expanded ? (
					<ChevronDownIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRightIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
				)}
				<span className={cn("text-[10px] font-medium", color)}>
					{label}
				</span>
				{sublabel && (
					<span className="text-[9px] text-muted-foreground/60">
						{sublabel}
					</span>
				)}
				{displayText && (
					<button
						type="button"
						onClick={handleCopy}
						className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground transition-opacity"
						aria-label={`Copy ${label}`}
					>
						{copied ? (
							<span className="text-[8px] text-green-500">Copied</span>
						) : (
							<CopyIcon className="h-2.5 w-2.5" />
						)}
					</button>
				)}
			</button>
			{expanded && (
				<div className="mt-1 mb-2">
					{displayText ? (
						<p className="text-[10px] leading-relaxed whitespace-pre-wrap text-foreground/80">
							{displayText}
						</p>
					) : (
						<p className="text-[10px] text-muted-foreground/40 italic">
							No prompt
						</p>
					)}
				</div>
			)}
		</div>
	);
}

// ── Image tab types ──────────────────────────────────────────────

type ImageTab = "first-frame" | "end-frame";

// ── Prompt tab pill colors ───────────────────────────────────────

const PROMPT_TABS = [
	{ key: "script", label: "Script", bg: "bg-purple-500/20", text: "text-purple-400" },
	{ key: "first", label: "First Frame", bg: "bg-green-500/20", text: "text-green-400" },
	{ key: "end", label: "End Frame", bg: "bg-red-500/20", text: "text-red-400" },
	{ key: "video", label: "Video", bg: "bg-blue-500/20", text: "text-blue-400" },
] as const;

// ── Main component ───────────────────────────────────────────────

interface ShotDetailReadProps {
	shot: Shot;
	onPreview: (url: string, type: "image" | "video") => void;
}

export function ShotDetailRead({ shot, onPreview }: ShotDetailReadProps) {
	const [imageTab, setImageTab] = useState<ImageTab>("first-frame");
	const [promptsExpanded, setPromptsExpanded] = useState(true);

	const hasFirstFrame = !!shot.imageUrl;
	const hasEndFrame = !!shot.endFrameImageUrl;

	return (
		<div className="space-y-2.5">
			{/* ── Action Summary ── */}
			{shot.actionSummary && (
				<p className="text-xs leading-relaxed">{shot.actionSummary}</p>
			)}

			{/* ── Image Section with Tabs (TOP — matches original) ── */}
			<div className="space-y-1">
				<div className="flex items-center gap-1">
					{(
						[
							{ key: "first-frame" as const, label: "First Frame", color: "orange" },
							{ key: "end-frame" as const, label: "End Frame", color: "orange" },
						] as const
					).map((tab) => {
						const isActive = imageTab === tab.key;
						const disabled =
							tab.key === "end-frame" && !hasEndFrame;
						return (
							<button
								key={tab.key}
								type="button"
								onClick={() => setImageTab(tab.key)}
								disabled={disabled}
								className={cn(
									"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
									isActive
										? "bg-orange-500/20 text-orange-400"
										: "text-muted-foreground hover:bg-muted/50",
									disabled && "opacity-30 cursor-not-allowed",
								)}
							>
								<ImageIcon className="h-3 w-3" />
								{tab.label}
							</button>
						);
					})}
				</div>
				<div className="rounded border overflow-hidden">
					{imageTab === "first-frame" && hasFirstFrame && (
						<button
							type="button"
							className="w-full cursor-pointer"
							onClick={() => onPreview(shot.imageUrl!, "image")}
						>
							<img
								src={shot.imageUrl}
								alt={`Shot ${shot.index + 1}`}
								className="w-full h-auto"
							/>
						</button>
					)}
					{imageTab === "end-frame" && hasEndFrame && (
						<button
							type="button"
							className="w-full cursor-pointer"
							onClick={() => onPreview(shot.endFrameImageUrl!, "image")}
						>
							<img
								src={shot.endFrameImageUrl}
								alt={`Shot ${shot.index + 1} end frame`}
								className="w-full h-auto"
							/>
						</button>
					)}
					{imageTab === "first-frame" && !hasFirstFrame && (
						<div className="flex items-center justify-center h-24 bg-muted/30 text-muted-foreground/40 text-xs">
							No image generated
						</div>
					)}
				</div>
			</div>

			{/* ── Prompts Section with Colored Tabs ── */}
			<div className="space-y-1.5">
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setPromptsExpanded(!promptsExpanded)}
						className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
					>
						{promptsExpanded ? (
							<ChevronDownIcon className="h-3 w-3" />
						) : (
							<ChevronRightIcon className="h-3 w-3" />
						)}
						Prompts
					</button>
					<div className="flex items-center gap-0.5">
						{PROMPT_TABS.map((tab) => (
							<span
								key={tab.key}
								className={cn(
									"px-1.5 py-0.5 rounded text-[8px] font-medium",
									tab.bg,
									tab.text,
								)}
							>
								{tab.label}
							</span>
						))}
					</div>
				</div>

				{promptsExpanded && (
					<div className="space-y-1">
						<PromptBlock
							label="Script Action"
							sublabel="(Prompt Source)"
							color="text-purple-400"
							dotColor="#a855f7"
							content={shot.actionSummary}
						/>
						<PromptBlock
							label="First Frame"
							sublabel="(Static Image)"
							color="text-green-400"
							dotColor="#22c55e"
							content={shot.imagePrompt}
							contentZh={shot.imagePromptZh}
						/>
						<PromptBlock
							label="End Frame"
							color="text-red-400"
							dotColor="#ef4444"
							content={shot.endFramePrompt}
							contentZh={shot.endFramePromptZh}
						/>
						<PromptBlock
							label="Video Prompt"
							sublabel="(Dynamic Action)"
							color="text-blue-400"
							dotColor="#3b82f6"
							content={shot.videoPrompt}
							contentZh={shot.videoPromptZh}
						/>
					</div>
				)}
			</div>

			{/* ── Emotion Tags ── */}
			{shot.emotionTags && shot.emotionTags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{shot.emotionTags.map((tag) => (
						<Badge
							key={tag}
							variant="outline"
							className="text-[9px] px-1.5 py-0"
						>
							{tag}
						</Badge>
					))}
				</div>
			)}

			{/* ── Audio Controls ── */}
			<div className="space-y-1">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					Audio
				</p>
				<div className="space-y-1">
					<AudioRow
						icon={Volume2Icon}
						label="Ambient"
						value={shot.ambientSound}
						color="bg-cyan-500/15 text-cyan-400"
					/>
					<AudioRow
						icon={ZapIcon}
						label="SFX"
						value={shot.soundEffect}
						color="bg-yellow-500/15 text-yellow-400"
					/>
					<AudioRow
						icon={SpeechIcon}
						label="Dialogue"
						value={shot.dialogue}
						color="bg-pink-500/15 text-pink-400"
					/>
					<AudioRow
						icon={MusicIcon}
						label="BGM"
						value={shot.bgm}
						color="bg-violet-500/15 text-violet-400"
					/>
				</div>
			</div>

			{/* ── Characters ── */}
			{shot.characterNames && shot.characterNames.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{shot.characterNames.map((name) => (
						<Badge
							key={name}
							variant="secondary"
							className="text-[10px] px-1"
						>
							{name}
						</Badge>
					))}
				</div>
			)}

			{/* ── Narrative (only when populated) ── */}
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

			{/* ── Camera Parameter Pills (BOTTOM — matches original) ── */}
			<div className="space-y-1 border-t pt-2">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					Camera
				</p>
				<div className="flex flex-wrap gap-1">
					<ParamPill
						icon={ClockIcon}
						label="Duration"
						value={shot.duration ? `${shot.duration}s` : undefined}
						color="green"
					/>
					<ParamPill
						icon={CameraIcon}
						label="Camera Rig"
						value={
							shot.cameraRig
								? (RIG_LABELS[shot.cameraRig] ?? shot.cameraRig)
								: undefined
						}
						color="blue"
					/>
					<ParamPill
						icon={EyeIcon}
						label="Angle"
						value={
							shot.cameraAngle
								? (ANGLE_LABELS[shot.cameraAngle] ?? shot.cameraAngle)
								: undefined
						}
						color="orange"
					/>
					<ParamPill
						icon={CrosshairIcon}
						label="Focal Length"
						value={shot.focalLength}
						color="purple"
					/>
					<ParamPill
						icon={ZapIcon}
						label="Technique"
						value={
							shot.photographyTechnique
								? (TECHNIQUE_LABELS[shot.photographyTechnique] ??
									shot.photographyTechnique)
								: undefined
						}
					/>
					{shot.playbackSpeed && shot.playbackSpeed !== "normal" && (
						<ParamPill
							icon={FilmIcon}
							label="Speed"
							value={SPEED_LABELS[shot.playbackSpeed] ?? shot.playbackSpeed}
							color="blue"
						/>
					)}
				</div>
				{shot.cameraMovement && (
					<p className="text-[10px] text-muted-foreground">
						{shot.cameraMovement}
					</p>
				)}
			</div>
		</div>
	);
}
