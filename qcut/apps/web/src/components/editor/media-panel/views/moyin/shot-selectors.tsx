/**
 * Shot metadata selectors — shot size, duration, emotion tags, sound design.
 * Used in ShotDetail for both read and edit modes.
 */

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ==================== Constants ====================

export const SHOT_SIZES = [
	{ value: "ECU", label: "ECU", desc: "Extreme Close-Up" },
	{ value: "CU", label: "CU", desc: "Close-Up" },
	{ value: "MCU", label: "MCU", desc: "Medium Close-Up" },
	{ value: "MS", label: "MS", desc: "Medium Shot" },
	{ value: "MLS", label: "MLS", desc: "Medium Long Shot" },
	{ value: "FS", label: "FS", desc: "Full Shot" },
	{ value: "WS", label: "WS", desc: "Wide Shot" },
	{ value: "EWS", label: "EWS", desc: "Extreme Wide Shot" },
] as const;

export const DURATION_OPTIONS = [3, 4, 5, 6, 7, 8, 10, 12] as const;

export const EMOTION_TAGS = [
	"sad",
	"tense",
	"serious",
	"angry",
	"scared",
	"happy",
	"excited",
	"melancholic",
	"peaceful",
	"romantic",
] as const;

export const SFX_PRESETS = [
	"rain",
	"wind",
	"thunder",
	"fire",
	"footsteps",
	"crowd",
	"traffic",
	"birds",
	"waves",
	"silence",
] as const;

// ==================== ShotSizeSelector ====================

export function ShotSizeSelector({
	value,
	onChange,
	readOnly,
}: {
	value?: string;
	onChange: (size: string) => void;
	readOnly?: boolean;
}) {
	if (readOnly) {
		if (!value) return null;
		const match = SHOT_SIZES.find((s) => s.value === value);
		return (
			<div className="space-y-0.5">
				<p className="text-[10px] font-medium text-muted-foreground">
					Shot Size
				</p>
				<Badge variant="outline" className="text-[10px] font-mono">
					{value}
					{match && ` — ${match.desc}`}
				</Badge>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<Label className="text-[10px]">Shot Size</Label>
			<div className="flex flex-wrap gap-1">
				{SHOT_SIZES.map((size) => (
					<button
						key={size.value}
						type="button"
						onClick={() => onChange(size.value)}
						title={size.desc}
						className={cn(
							"px-1.5 py-0.5 rounded text-[9px] font-mono font-medium transition-colors",
							value === size.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						)}
					>
						{size.label}
					</button>
				))}
			</div>
		</div>
	);
}

// ==================== DurationSelector ====================

export function DurationSelector({
	value,
	onChange,
	readOnly,
}: {
	value?: number;
	onChange: (duration: number) => void;
	readOnly?: boolean;
}) {
	if (readOnly) {
		if (!value) return null;
		return (
			<div className="space-y-0.5">
				<p className="text-[10px] font-medium text-muted-foreground">
					Duration
				</p>
				<p className="text-xs">{value}s</p>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<Label className="text-[10px]">Duration (seconds)</Label>
			<div className="flex flex-wrap gap-1">
				{DURATION_OPTIONS.map((d) => (
					<button
						key={d}
						type="button"
						onClick={() => onChange(d)}
						className={cn(
							"px-1.5 py-0.5 rounded text-[9px] font-mono font-medium transition-colors",
							value === d
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						)}
					>
						{d}s
					</button>
				))}
			</div>
		</div>
	);
}

// ==================== EmotionTagSelector ====================

export function EmotionTagSelector({
	value,
	onChange,
	readOnly,
}: {
	value?: string[];
	onChange: (tags: string[]) => void;
	readOnly?: boolean;
}) {
	const selected = value ?? [];

	const toggle = (tag: string) => {
		if (selected.includes(tag)) {
			onChange(selected.filter((t) => t !== tag));
		} else {
			onChange([...selected, tag]);
		}
	};

	if (readOnly) {
		if (selected.length === 0) return null;
		return (
			<div className="space-y-0.5">
				<p className="text-[10px] font-medium text-muted-foreground">
					Emotions
				</p>
				<div className="flex flex-wrap gap-1">
					{selected.map((tag) => (
						<Badge key={tag} variant="secondary" className="text-[10px] px-1.5">
							{tag}
						</Badge>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<Label className="text-[10px]">Emotion Tags</Label>
			<div className="flex flex-wrap gap-1">
				{EMOTION_TAGS.map((tag) => (
					<button
						key={tag}
						type="button"
						onClick={() => toggle(tag)}
						className={cn(
							"px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
							selected.includes(tag)
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						)}
					>
						{tag}
					</button>
				))}
			</div>
		</div>
	);
}

// ==================== SoundDesignInput ====================

export function SoundDesignInput({
	ambientSound,
	soundEffect,
	onAmbientChange,
	onSfxChange,
	readOnly,
}: {
	ambientSound?: string;
	soundEffect?: string;
	onAmbientChange: (value: string) => void;
	onSfxChange: (value: string) => void;
	readOnly?: boolean;
}) {
	if (readOnly) {
		if (!ambientSound && !soundEffect) return null;
		return (
			<div className="space-y-1">
				{ambientSound && (
					<div className="space-y-0.5">
						<p className="text-[10px] font-medium text-muted-foreground">
							Ambient Sound
						</p>
						<p className="text-xs">{ambientSound}</p>
					</div>
				)}
				{soundEffect && (
					<div className="space-y-0.5">
						<p className="text-[10px] font-medium text-muted-foreground">
							Sound Effects
						</p>
						<p className="text-xs">{soundEffect}</p>
					</div>
				)}
			</div>
		);
	}

	const addSfxPreset = (preset: string) => {
		const current = soundEffect ? soundEffect.split(", ") : [];
		if (current.includes(preset)) {
			onSfxChange(current.filter((s) => s !== preset).join(", "));
		} else {
			onSfxChange([...current, preset].join(", "));
		}
	};

	const activeSfx = soundEffect ? soundEffect.split(", ") : [];

	return (
		<div className="space-y-2">
			<div className="space-y-1">
				<Label className="text-[10px]">Ambient Sound</Label>
				<Textarea
					className="text-xs min-h-[32px] resize-none"
					rows={1}
					value={ambientSound ?? ""}
					onChange={(e) => onAmbientChange(e.target.value)}
					placeholder="e.g. quiet office, distant traffic"
				/>
			</div>
			<div className="space-y-1">
				<Label className="text-[10px]">Sound Effects</Label>
				<div className="flex flex-wrap gap-1">
					{SFX_PRESETS.map((sfx) => (
						<button
							key={sfx}
							type="button"
							onClick={() => addSfxPreset(sfx)}
							className={cn(
								"px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
								activeSfx.includes(sfx)
									? "bg-primary text-primary-foreground"
									: "bg-muted text-muted-foreground hover:bg-muted/80"
							)}
						>
							{sfx}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
