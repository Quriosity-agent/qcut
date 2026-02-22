/**
 * Cinematic vocabulary selectors for shots.
 * Covers all 5 professional roles: Gaffer, Focus Puller, Camera Rig,
 * On-set SFX, and Speed — plus angle, focal length, and technique.
 */

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
	LightingStyle,
	LightingDirection,
	ColorTemperature,
	DepthOfField,
	FocusTransition,
	CameraRig,
	MovementSpeed,
	AtmosphericEffect,
	EffectIntensity,
	PlaybackSpeed,
	CameraAngle,
	FocalLength,
	PhotographyTechnique,
} from "@/types/moyin-script";

// ==================== Generic Selector Factory ====================

interface SelectorOption<T extends string> {
	value: T;
	label: string;
}

/** Single-select button group for enum values. */
function EnumSelector<T extends string>({
	label,
	options,
	value,
	onChange,
	readOnly,
}: {
	label: string;
	options: readonly SelectorOption<T>[];
	value?: T;
	onChange: (v: T) => void;
	readOnly?: boolean;
}) {
	if (readOnly) {
		if (!value) return null;
		const match = options.find((o) => o.value === value);
		return (
			<div className="space-y-0.5">
				<p className="text-[10px] font-medium text-muted-foreground">{label}</p>
				<Badge variant="outline" className="text-[10px]">
					{match?.label ?? value}
				</Badge>
			</div>
		);
	}
	return (
		<div className="space-y-1">
			<Label className="text-[10px]">{label}</Label>
			<div className="flex flex-wrap gap-1" role="group" aria-label={label}>
				{options.map((opt) => (
					<button
						key={opt.value}
						type="button"
						aria-pressed={value === opt.value}
						onClick={() => onChange(opt.value)}
						className={cn(
							"px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
							value === opt.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						)}
					>
						{opt.label}
					</button>
				))}
			</div>
		</div>
	);
}

/** Multi-select pill buttons for array values. */
function MultiEnumSelector<T extends string>({
	label,
	options,
	value,
	onChange,
	readOnly,
}: {
	label: string;
	options: readonly SelectorOption<T>[];
	value?: T[];
	onChange: (v: T[]) => void;
	readOnly?: boolean;
}) {
	const selected = value ?? [];
	const toggle = (item: T) => {
		if (selected.includes(item)) {
			onChange(selected.filter((s) => s !== item));
		} else {
			onChange([...selected, item]);
		}
	};

	if (readOnly) {
		if (selected.length === 0) return null;
		return (
			<div className="space-y-0.5">
				<p className="text-[10px] font-medium text-muted-foreground">{label}</p>
				<div className="flex flex-wrap gap-1">
					{selected.map((v) => {
						const match = options.find((o) => o.value === v);
						return (
							<Badge key={v} variant="secondary" className="text-[10px] px-1.5">
								{match?.label ?? v}
							</Badge>
						);
					})}
				</div>
			</div>
		);
	}
	return (
		<div className="space-y-1">
			<Label className="text-[10px]">{label}</Label>
			<div className="flex flex-wrap gap-1" role="group" aria-label={label}>
				{options.map((opt) => (
					<button
						key={opt.value}
						type="button"
						aria-pressed={selected.includes(opt.value)}
						onClick={() => toggle(opt.value)}
						className={cn(
							"px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
							selected.includes(opt.value)
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						)}
					>
						{opt.label}
					</button>
				))}
			</div>
		</div>
	);
}

// ==================== Option Constants ====================

const LIGHTING_STYLES: SelectorOption<LightingStyle>[] = [
	{ value: "high-key", label: "High-Key" },
	{ value: "low-key", label: "Low-Key" },
	{ value: "silhouette", label: "Silhouette" },
	{ value: "chiaroscuro", label: "Chiaroscuro" },
	{ value: "natural", label: "Natural" },
	{ value: "neon", label: "Neon" },
	{ value: "candlelight", label: "Candle" },
	{ value: "moonlight", label: "Moonlight" },
];

const LIGHTING_DIRECTIONS: SelectorOption<LightingDirection>[] = [
	{ value: "front", label: "Front" },
	{ value: "side", label: "Side" },
	{ value: "back", label: "Back" },
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
	{ value: "rim", label: "Rim" },
	{ value: "three-point", label: "3-Point" },
];

const COLOR_TEMPERATURES: SelectorOption<ColorTemperature>[] = [
	{ value: "warm", label: "Warm" },
	{ value: "neutral", label: "Neutral" },
	{ value: "cool", label: "Cool" },
	{ value: "golden-hour", label: "Golden Hr" },
	{ value: "blue-hour", label: "Blue Hr" },
	{ value: "mixed", label: "Mixed" },
];

const DEPTH_OF_FIELDS: SelectorOption<DepthOfField>[] = [
	{ value: "ultra-shallow", label: "Ultra-Shallow" },
	{ value: "shallow", label: "Shallow" },
	{ value: "medium", label: "Medium" },
	{ value: "deep", label: "Deep" },
	{ value: "split-diopter", label: "Split Diopter" },
];

const FOCUS_TRANSITIONS: SelectorOption<FocusTransition>[] = [
	{ value: "rack-to-fg", label: "Rack→FG" },
	{ value: "rack-to-bg", label: "Rack→BG" },
	{ value: "rack-between", label: "Rack Between" },
	{ value: "pull-focus", label: "Pull Focus" },
	{ value: "none", label: "None" },
];

const CAMERA_RIGS: SelectorOption<CameraRig>[] = [
	{ value: "tripod", label: "Tripod" },
	{ value: "handheld", label: "Handheld" },
	{ value: "steadicam", label: "Steadicam" },
	{ value: "dolly", label: "Dolly" },
	{ value: "crane", label: "Crane" },
	{ value: "drone", label: "Drone" },
	{ value: "shoulder", label: "Shoulder" },
	{ value: "slider", label: "Slider" },
];

const MOVEMENT_SPEEDS: SelectorOption<MovementSpeed>[] = [
	{ value: "very-slow", label: "Very Slow" },
	{ value: "slow", label: "Slow" },
	{ value: "normal", label: "Normal" },
	{ value: "fast", label: "Fast" },
	{ value: "very-fast", label: "Very Fast" },
];

const ATMOSPHERIC_EFFECTS: SelectorOption<AtmosphericEffect>[] = [
	{ value: "rain", label: "Rain" },
	{ value: "heavy-rain", label: "Heavy Rain" },
	{ value: "snow", label: "Snow" },
	{ value: "blizzard", label: "Blizzard" },
	{ value: "fog", label: "Fog" },
	{ value: "mist", label: "Mist" },
	{ value: "dust", label: "Dust" },
	{ value: "sandstorm", label: "Sandstorm" },
	{ value: "smoke", label: "Smoke" },
	{ value: "haze", label: "Haze" },
	{ value: "fire", label: "Fire" },
	{ value: "sparks", label: "Sparks" },
	{ value: "lens-flare", label: "Lens Flare" },
	{ value: "light-rays", label: "Light Rays" },
	{ value: "falling-leaves", label: "Leaves" },
	{ value: "cherry-blossom", label: "Cherry" },
	{ value: "fireflies", label: "Fireflies" },
	{ value: "particles", label: "Particles" },
];

const EFFECT_INTENSITIES: SelectorOption<EffectIntensity>[] = [
	{ value: "subtle", label: "Subtle" },
	{ value: "moderate", label: "Moderate" },
	{ value: "heavy", label: "Heavy" },
];

const PLAYBACK_SPEEDS: SelectorOption<PlaybackSpeed>[] = [
	{ value: "slow-motion-4x", label: "0.25x" },
	{ value: "slow-motion-2x", label: "0.5x" },
	{ value: "normal", label: "1x" },
	{ value: "fast-2x", label: "2x" },
	{ value: "timelapse", label: "Timelapse" },
];

const CAMERA_ANGLES: SelectorOption<CameraAngle>[] = [
	{ value: "eye-level", label: "Eye Level" },
	{ value: "high-angle", label: "High" },
	{ value: "low-angle", label: "Low" },
	{ value: "birds-eye", label: "Bird's Eye" },
	{ value: "worms-eye", label: "Worm's Eye" },
	{ value: "over-shoulder", label: "OTS" },
	{ value: "side-angle", label: "Side" },
	{ value: "dutch-angle", label: "Dutch" },
	{ value: "third-person", label: "3rd Person" },
];

const FOCAL_LENGTHS: SelectorOption<FocalLength>[] = [
	{ value: "8mm", label: "8mm" },
	{ value: "14mm", label: "14mm" },
	{ value: "24mm", label: "24mm" },
	{ value: "35mm", label: "35mm" },
	{ value: "50mm", label: "50mm" },
	{ value: "85mm", label: "85mm" },
	{ value: "105mm", label: "105mm" },
	{ value: "135mm", label: "135mm" },
	{ value: "200mm", label: "200mm" },
	{ value: "400mm", label: "400mm" },
];

const PHOTOGRAPHY_TECHNIQUES: SelectorOption<PhotographyTechnique>[] = [
	{ value: "long-exposure", label: "Long Exp." },
	{ value: "double-exposure", label: "Double Exp." },
	{ value: "macro", label: "Macro" },
	{ value: "tilt-shift", label: "Tilt-Shift" },
	{ value: "high-speed", label: "High-Speed" },
	{ value: "bokeh", label: "Bokeh" },
	{ value: "reflection", label: "Reflection" },
	{ value: "silhouette-technique", label: "Silhouette" },
];

// ==================== Exported Selectors ====================

// --- Gaffer (Lighting) ---

interface LightingSelectorProps {
	lightingStyle?: LightingStyle;
	lightingDirection?: LightingDirection;
	colorTemperature?: ColorTemperature;
	onStyleChange: (v: LightingStyle) => void;
	onDirectionChange: (v: LightingDirection) => void;
	onTempChange: (v: ColorTemperature) => void;
	readOnly?: boolean;
}

export function LightingSelector({
	lightingStyle,
	lightingDirection,
	colorTemperature,
	onStyleChange,
	onDirectionChange,
	onTempChange,
	readOnly,
}: LightingSelectorProps) {
	return (
		<div className="space-y-1.5">
			<EnumSelector
				label="Lighting Style"
				options={LIGHTING_STYLES}
				value={lightingStyle}
				onChange={onStyleChange}
				readOnly={readOnly}
			/>
			<EnumSelector
				label="Light Direction"
				options={LIGHTING_DIRECTIONS}
				value={lightingDirection}
				onChange={onDirectionChange}
				readOnly={readOnly}
			/>
			<EnumSelector
				label="Color Temperature"
				options={COLOR_TEMPERATURES}
				value={colorTemperature}
				onChange={onTempChange}
				readOnly={readOnly}
			/>
		</div>
	);
}

// --- Focus Puller ---

interface FocusSelectorProps {
	depthOfField?: DepthOfField;
	focusTransition?: FocusTransition;
	onDofChange: (v: DepthOfField) => void;
	onTransitionChange: (v: FocusTransition) => void;
	readOnly?: boolean;
}

export function FocusSelector({
	depthOfField,
	focusTransition,
	onDofChange,
	onTransitionChange,
	readOnly,
}: FocusSelectorProps) {
	return (
		<div className="space-y-1.5">
			<EnumSelector
				label="Depth of Field"
				options={DEPTH_OF_FIELDS}
				value={depthOfField}
				onChange={onDofChange}
				readOnly={readOnly}
			/>
			<EnumSelector
				label="Focus Transition"
				options={FOCUS_TRANSITIONS}
				value={focusTransition}
				onChange={onTransitionChange}
				readOnly={readOnly}
			/>
		</div>
	);
}

// --- Camera Rig ---

interface RigSelectorProps {
	cameraRig?: CameraRig;
	movementSpeed?: MovementSpeed;
	onRigChange: (v: CameraRig) => void;
	onSpeedChange: (v: MovementSpeed) => void;
	readOnly?: boolean;
}

export function RigSelector({
	cameraRig,
	movementSpeed,
	onRigChange,
	onSpeedChange,
	readOnly,
}: RigSelectorProps) {
	return (
		<div className="space-y-1.5">
			<EnumSelector
				label="Camera Rig"
				options={CAMERA_RIGS}
				value={cameraRig}
				onChange={onRigChange}
				readOnly={readOnly}
			/>
			<EnumSelector
				label="Movement Speed"
				options={MOVEMENT_SPEEDS}
				value={movementSpeed}
				onChange={onSpeedChange}
				readOnly={readOnly}
			/>
		</div>
	);
}

// --- Atmospheric Effects ---

interface AtmosphereSelectorProps {
	atmosphericEffects?: AtmosphericEffect[];
	effectIntensity?: EffectIntensity;
	onEffectsChange: (v: AtmosphericEffect[]) => void;
	onIntensityChange: (v: EffectIntensity) => void;
	readOnly?: boolean;
}

export function AtmosphereSelector({
	atmosphericEffects,
	effectIntensity,
	onEffectsChange,
	onIntensityChange,
	readOnly,
}: AtmosphereSelectorProps) {
	return (
		<div className="space-y-1.5">
			<MultiEnumSelector
				label="Atmospheric Effects"
				options={ATMOSPHERIC_EFFECTS}
				value={atmosphericEffects}
				onChange={onEffectsChange}
				readOnly={readOnly}
			/>
			<EnumSelector
				label="Effect Intensity"
				options={EFFECT_INTENSITIES}
				value={effectIntensity}
				onChange={onIntensityChange}
				readOnly={readOnly}
			/>
		</div>
	);
}

// --- Playback Speed ---

interface SpeedSelectorProps {
	playbackSpeed?: PlaybackSpeed;
	onChange: (v: PlaybackSpeed) => void;
	readOnly?: boolean;
}

export function SpeedSelector({
	playbackSpeed,
	onChange,
	readOnly,
}: SpeedSelectorProps) {
	return (
		<EnumSelector
			label="Playback Speed"
			options={PLAYBACK_SPEEDS}
			value={playbackSpeed}
			onChange={onChange}
			readOnly={readOnly}
		/>
	);
}

// --- Camera Angle ---

interface AngleSelectorProps {
	cameraAngle?: CameraAngle;
	onChange: (v: CameraAngle) => void;
	readOnly?: boolean;
}

export function AngleSelector({
	cameraAngle,
	onChange,
	readOnly,
}: AngleSelectorProps) {
	return (
		<EnumSelector
			label="Camera Angle"
			options={CAMERA_ANGLES}
			value={cameraAngle}
			onChange={onChange}
			readOnly={readOnly}
		/>
	);
}

// --- Focal Length ---

interface FocalLengthSelectorProps {
	focalLength?: FocalLength;
	onChange: (v: FocalLength) => void;
	readOnly?: boolean;
}

export function FocalLengthSelector({
	focalLength,
	onChange,
	readOnly,
}: FocalLengthSelectorProps) {
	return (
		<EnumSelector
			label="Focal Length"
			options={FOCAL_LENGTHS}
			value={focalLength}
			onChange={onChange}
			readOnly={readOnly}
		/>
	);
}

// --- Photography Technique ---

interface TechniqueSelectorProps {
	photographyTechnique?: PhotographyTechnique;
	onChange: (v: PhotographyTechnique) => void;
	readOnly?: boolean;
}

export function TechniqueSelector({
	photographyTechnique,
	onChange,
	readOnly,
}: TechniqueSelectorProps) {
	return (
		<EnumSelector
			label="Photography Technique"
			options={PHOTOGRAPHY_TECHNIQUES}
			value={photographyTechnique}
			onChange={onChange}
			readOnly={readOnly}
		/>
	);
}
