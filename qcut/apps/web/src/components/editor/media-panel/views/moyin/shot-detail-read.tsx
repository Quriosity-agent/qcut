/**
 * ShotDetailRead — Rich read-mode display for shot details.
 * Shows camera parameter pills, audio controls, and image tabs
 * matching the moyin-creator visual style.
 */

import { useState } from "react";
import type { Shot } from "@/types/moyin-script";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	CameraIcon,
	ClockIcon,
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

function ParamPill({
	icon: Icon,
	label,
	value,
	color = "default",
}: {
	icon?: React.ElementType;
	label: string;
	value: string | undefined;
	color?: "default" | "blue" | "green" | "orange" | "purple";
}) {
	const colorClasses = {
		default: "bg-muted/60 text-muted-foreground",
		blue: "bg-blue-500/15 text-blue-400",
		green: "bg-green-500/15 text-green-400",
		orange: "bg-orange-500/15 text-orange-400",
		purple: "bg-purple-500/15 text-purple-400",
	};
	return (
		<div
			className={cn(
				"inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium",
				value ? colorClasses[color] : "bg-muted/40 text-muted-foreground/40",
			)}
			title={label}
		>
			{Icon && <Icon className="h-2.5 w-2.5 shrink-0" />}
			<span>{value || "—"}</span>
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
				{value || "—"}
			</span>
		</div>
	);
}

// ── Image tab types ──────────────────────────────────────────────

type ImageTab = "first-frame" | "end-frame";

// ── Main component ───────────────────────────────────────────────

interface ShotDetailReadProps {
	shot: Shot;
	onPreview: (url: string, type: "image" | "video") => void;
}

export function ShotDetailRead({ shot, onPreview }: ShotDetailReadProps) {
	const [imageTab, setImageTab] = useState<ImageTab>("first-frame");

	const hasFirstFrame = !!shot.imageUrl;
	const hasEndFrame = !!shot.endFrameImageUrl;

	return (
		<div className="space-y-2.5">
			{/* ── Camera Parameter Pills ── */}
			<div className="space-y-1">
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

			{/* ── Image Section with Tabs ── */}
			{(hasFirstFrame || hasEndFrame) && (
				<div className="space-y-1">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setImageTab("first-frame")}
							className={cn(
								"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
								imageTab === "first-frame"
									? "bg-blue-500/20 text-blue-400"
									: "text-muted-foreground hover:bg-muted/50",
							)}
						>
							<ImageIcon className="h-3 w-3" />
							First Frame
						</button>
						<button
							type="button"
							onClick={() => setImageTab("end-frame")}
							className={cn(
								"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
								imageTab === "end-frame"
									? "bg-orange-500/20 text-orange-400"
									: "text-muted-foreground hover:bg-muted/50",
								!hasEndFrame && "opacity-40 cursor-not-allowed",
							)}
							disabled={!hasEndFrame}
						>
							<MicIcon className="h-3 w-3" />
							End Frame
						</button>
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
		</div>
	);
}
