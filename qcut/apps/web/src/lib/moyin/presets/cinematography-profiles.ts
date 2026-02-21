/**
 * Cinematography Profile Presets
 * Ported from moyin-creator
 *
 * Project-level cinematography language baseline.
 * AI calibration uses these as defaults; prompt builder falls back here
 * when per-shot fields are empty.
 */

import type {
	AtmosphericEffect,
	CameraAngle,
	CameraRig,
	ColorTemperature,
	DepthOfField,
	EffectIntensity,
	FocalLength,
	FocusTransition,
	LightingDirection,
	LightingStyle,
	MovementSpeed,
	PhotographyTechnique,
	PlaybackSpeed,
} from "@/types/moyin-script";

// ==================== Types ====================

export type CinematographyCategory =
	| "cinematic"
	| "documentary"
	| "stylized"
	| "genre"
	| "era";

export interface CinematographyProfile {
	id: string;
	name: string;
	nameEn: string;
	category: CinematographyCategory;
	description: string;
	emoji: string;

	defaultLighting: {
		style: LightingStyle;
		direction: LightingDirection;
		colorTemperature: ColorTemperature;
	};

	defaultFocus: {
		depthOfField: DepthOfField;
		focusTransition: FocusTransition;
	};

	defaultRig: {
		cameraRig: CameraRig;
		movementSpeed: MovementSpeed;
	};

	defaultAtmosphere: {
		effects: AtmosphericEffect[];
		intensity: EffectIntensity;
	};

	defaultSpeed: {
		playbackSpeed: PlaybackSpeed;
	};

	defaultAngle?: CameraAngle;
	defaultFocalLength?: FocalLength;
	defaultTechnique?: PhotographyTechnique;

	/** AI cinematography guidance (injected into system prompt) */
	promptGuidance: string;
	/** Reference films */
	referenceFilms: string[];
}

// ==================== Categories ====================

export const CINEMATOGRAPHY_CATEGORIES: {
	id: CinematographyCategory;
	name: string;
	emoji: string;
}[] = [
	{ id: "cinematic", name: "Cinematic", emoji: "\uD83C\uDFAC" },
	{ id: "documentary", name: "Documentary", emoji: "\uD83D\uDCF9" },
	{ id: "stylized", name: "Stylized", emoji: "\uD83C\uDFA8" },
	{ id: "genre", name: "Genre", emoji: "\uD83C\uDFAD" },
	{ id: "era", name: "Era", emoji: "\uD83D\uDCC5" },
];

// ==================== Profiles ====================

const CINEMATIC_PROFILES: CinematographyProfile[] = [
	{
		id: "classic-cinematic",
		name: "Classic Cinematic",
		nameEn: "Classic Cinematic",
		category: "cinematic",
		description:
			"Standard theatrical film quality. Three-point lighting, natural color temperature, smooth dolly moves.",
		emoji: "\uD83C\uDFDE\uFE0F",
		defaultLighting: {
			style: "natural",
			direction: "three-point",
			colorTemperature: "warm",
		},
		defaultFocus: {
			depthOfField: "medium",
			focusTransition: "rack-between",
		},
		defaultRig: { cameraRig: "dolly", movementSpeed: "slow" },
		defaultAtmosphere: { effects: [], intensity: "subtle" },
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "50mm",
		promptGuidance:
			"Follow classic film grammar. Three-point lighting as baseline, warm tones for warmth. Dolly tracking for stable, fluid shots. Adjust depth of field by narrative function: shallow for emotional close-ups, deep for establishing shots.",
		referenceFilms: [
			"The Shawshank Redemption",
			"Forrest Gump",
			"The Godfather",
		],
	},
	{
		id: "film-noir",
		name: "Film Noir",
		nameEn: "Film Noir",
		category: "cinematic",
		description:
			"Low-key lighting, strong contrast, side-lit, cool tones, fog and smoke, handheld tension.",
		emoji: "\uD83D\uDDA4",
		defaultLighting: {
			style: "low-key",
			direction: "side",
			colorTemperature: "cool",
		},
		defaultFocus: {
			depthOfField: "shallow",
			focusTransition: "rack-to-fg",
		},
		defaultRig: { cameraRig: "handheld", movementSpeed: "slow" },
		defaultAtmosphere: {
			effects: ["fog", "smoke"],
			intensity: "moderate",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "low-angle",
		defaultFocalLength: "35mm",
		promptGuidance:
			"Film noir lives in shadows. Large shadow areas with a single side light on the subject. Cool tones with fog create unease. Handheld micro-shake adds authentic tension. Keep half the face in darkness to suggest duality.",
		referenceFilms: ["Blade Runner", "Chinatown", "The Third Man", "Sin City"],
	},
	{
		id: "epic-blockbuster",
		name: "Epic Blockbuster",
		nameEn: "Epic Blockbuster",
		category: "cinematic",
		description:
			"High-key, front-lit, deep focus, crane sweeps, lens flare, grandiose scale.",
		emoji: "\u2694\uFE0F",
		defaultLighting: {
			style: "high-key",
			direction: "front",
			colorTemperature: "neutral",
		},
		defaultFocus: { depthOfField: "deep", focusTransition: "none" },
		defaultRig: { cameraRig: "crane", movementSpeed: "normal" },
		defaultAtmosphere: {
			effects: ["lens-flare", "dust"],
			intensity: "moderate",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "24mm",
		promptGuidance:
			"Epic scale comes from spatial depth. Deep focus and crane sweeps reveal grand landscapes. Front high-key lighting keeps the frame bright and impressive. Add lens flare and dust particles for cinematic feel. Switch to handheld for battle sequences.",
		referenceFilms: [
			"Lord of the Rings",
			"Gladiator",
			"Braveheart",
			"Kingdom of Heaven",
		],
	},
	{
		id: "intimate-drama",
		name: "Intimate Drama",
		nameEn: "Intimate Drama",
		category: "cinematic",
		description:
			"Natural side light, warm tones, shallow focus, static tripod, quiet and introspective.",
		emoji: "\uD83E\uDEF2",
		defaultLighting: {
			style: "natural",
			direction: "side",
			colorTemperature: "warm",
		},
		defaultFocus: {
			depthOfField: "shallow",
			focusTransition: "rack-between",
		},
		defaultRig: { cameraRig: "tripod", movementSpeed: "very-slow" },
		defaultAtmosphere: { effects: [], intensity: "subtle" },
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "85mm",
		promptGuidance:
			"Intimate drama uses static shots and shallow depth of field to pull viewers into the character's inner world. Natural side light creates facial light/shadow layers, warm tones convey emotional warmth. Camera barely moves, letting micro-expressions be the focus.",
		referenceFilms: [
			"Manchester by the Sea",
			"Marriage Story",
			"In the Mood for Love",
		],
	},
	{
		id: "romantic-film",
		name: "Romantic Film",
		nameEn: "Romantic Film",
		category: "cinematic",
		description:
			"Backlit golden hour, ultra-shallow focus, steadicam glide, light rays, dreamy softness.",
		emoji: "\uD83D\uDC95",
		defaultLighting: {
			style: "natural",
			direction: "back",
			colorTemperature: "golden-hour",
		},
		defaultFocus: {
			depthOfField: "ultra-shallow",
			focusTransition: "pull-focus",
		},
		defaultRig: { cameraRig: "steadicam", movementSpeed: "slow" },
		defaultAtmosphere: {
			effects: ["light-rays", "cherry-blossom"],
			intensity: "subtle",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "85mm",
		defaultTechnique: "bokeh",
		promptGuidance:
			"Romance is built on backlight. Golden hour warmth makes character outlines glow. Ultra-shallow focus dissolves the world into bokeh. Steadicam gently follows subjects as if walking through a dream. Occasional petals or light rays add poetry.",
		referenceFilms: [
			"The Notebook",
			"La La Land",
			"Pride and Prejudice",
			"Love Letter",
		],
	},
];

const DOCUMENTARY_PROFILES: CinematographyProfile[] = [
	{
		id: "documentary-raw",
		name: "Raw Documentary",
		nameEn: "Raw Documentary",
		category: "documentary",
		description:
			"Handheld breathing, natural light, medium focus, front-lit, unpolished, authentically raw.",
		emoji: "\uD83D\uDCF9",
		defaultLighting: {
			style: "natural",
			direction: "front",
			colorTemperature: "neutral",
		},
		defaultFocus: {
			depthOfField: "medium",
			focusTransition: "pull-focus",
		},
		defaultRig: { cameraRig: "handheld", movementSpeed: "normal" },
		defaultAtmosphere: { effects: [], intensity: "subtle" },
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "35mm",
		promptGuidance:
			"Documentary style pursues presence. Handheld camera shake makes viewers feel they are there. Pure natural light, no artificial modification. Focus follows subject movement, allowing occasional focus misses for authenticity.",
		referenceFilms: ["Life Is Fruity", "The Cove", "Free Solo"],
	},
	{
		id: "news-report",
		name: "News Report",
		nameEn: "News Report",
		category: "documentary",
		description:
			"Shoulder-mounted, high-key, deep focus, neutral tones, information-first, crisp and sharp.",
		emoji: "\uD83D\uDCE1",
		defaultLighting: {
			style: "high-key",
			direction: "front",
			colorTemperature: "neutral",
		},
		defaultFocus: { depthOfField: "deep", focusTransition: "none" },
		defaultRig: { cameraRig: "shoulder", movementSpeed: "normal" },
		defaultAtmosphere: { effects: [], intensity: "subtle" },
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "24mm",
		promptGuidance:
			"News documentary prioritizes information delivery. Deep focus ensures all elements are clear, high-key light eliminates shadows for complete detail visibility. Shoulder-mounted camera stays flexible but more stable than handheld.",
		referenceFilms: ["Spotlight", "All the President's Men", "The Post"],
	},
];

const STYLIZED_PROFILES: CinematographyProfile[] = [
	{
		id: "cyberpunk-neon",
		name: "Cyberpunk Neon",
		nameEn: "Cyberpunk Neon",
		category: "stylized",
		description:
			"Neon lighting, rim light, mixed color temp, shallow focus, stabilizer glide, haze-filled.",
		emoji: "\uD83C\uDF03",
		defaultLighting: {
			style: "neon",
			direction: "rim",
			colorTemperature: "mixed",
		},
		defaultFocus: {
			depthOfField: "shallow",
			focusTransition: "rack-to-bg",
		},
		defaultRig: { cameraRig: "steadicam", movementSpeed: "slow" },
		defaultAtmosphere: {
			effects: ["haze", "lens-flare"],
			intensity: "moderate",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "low-angle",
		defaultFocalLength: "35mm",
		defaultTechnique: "reflection",
		promptGuidance:
			"Cyberpunk visual language is warm/cool conflict. Neon purple-red and ice-blue in the same frame. Rim light separates subjects from dark backgrounds. Shallow focus turns neon into psychedelic bokeh. Haze adds volume to light. Slow camera glides through rain-slicked streets.",
		referenceFilms: [
			"Blade Runner 2049",
			"Ghost in the Shell",
			"The Matrix",
			"Tron: Legacy",
		],
	},
	{
		id: "wuxia-classic",
		name: "Classic Wuxia",
		nameEn: "Classic Wuxia",
		category: "stylized",
		description:
			"Natural side light, warm tones, medium focus, crane sweeps, mist and falling leaves.",
		emoji: "\uD83D\uDDE1\uFE0F",
		defaultLighting: {
			style: "natural",
			direction: "side",
			colorTemperature: "warm",
		},
		defaultFocus: {
			depthOfField: "medium",
			focusTransition: "rack-between",
		},
		defaultRig: { cameraRig: "crane", movementSpeed: "slow" },
		defaultAtmosphere: {
			effects: ["mist", "falling-leaves"],
			intensity: "moderate",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "50mm",
		promptGuidance:
			"Classic wuxia pursues atmosphere. Mountain mist and falling leaves create the vastness of the martial world. Crane descends from above to characters, like gazing over the world. Natural side light simulates dappled light through bamboo groves. Add slow motion for combat sequences to showcase martial beauty.",
		referenceFilms: [
			"Crouching Tiger Hidden Dragon",
			"Hero",
			"The Assassin",
			"The Grandmaster",
		],
	},
	{
		id: "horror-thriller",
		name: "Horror Thriller",
		nameEn: "Horror Thriller",
		category: "stylized",
		description:
			"Low-key bottom-lit, cool tones, shallow focus, handheld tremor, dense fog.",
		emoji: "\uD83D\uDC7B",
		defaultLighting: {
			style: "low-key",
			direction: "bottom",
			colorTemperature: "cool",
		},
		defaultFocus: {
			depthOfField: "shallow",
			focusTransition: "rack-to-bg",
		},
		defaultRig: { cameraRig: "handheld", movementSpeed: "very-slow" },
		defaultAtmosphere: {
			effects: ["fog", "haze"],
			intensity: "heavy",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "low-angle",
		defaultFocalLength: "24mm",
		promptGuidance:
			"Horror cinematography: hiding is scarier than showing. Shallow focus blurs the background into unknown threat. Dense fog restricts visibility, creating unease. Bottom-light casts unnatural face shadows. Very slow handheld creates stalking tension. Break the slow pace with sudden fast whip-pans at key moments.",
		referenceFilms: ["The Shining", "Hereditary", "The Conjuring", "Ringu"],
	},
	{
		id: "music-video",
		name: "Music Video",
		nameEn: "Music Video",
		category: "stylized",
		description:
			"Neon backlight, mixed color temp, ultra-shallow focus, fast steadicam orbit, heavy particles.",
		emoji: "\uD83C\uDFB5",
		defaultLighting: {
			style: "neon",
			direction: "back",
			colorTemperature: "mixed",
		},
		defaultFocus: {
			depthOfField: "ultra-shallow",
			focusTransition: "pull-focus",
		},
		defaultRig: { cameraRig: "steadicam", movementSpeed: "fast" },
		defaultAtmosphere: {
			effects: ["particles", "lens-flare"],
			intensity: "heavy",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "low-angle",
		defaultFocalLength: "35mm",
		defaultTechnique: "bokeh",
		promptGuidance:
			"MV pursues maximum visual impact. Every frame should look like a poster. Ultra-shallow focus dissolves everything into rainbow bokeh. Neon backlight outlines the subject. Fast steadicam orbits with frequent speed changes (slow-mo and fast-forward alternating). Heavy use of particles and lens flare for dreamlike quality.",
		referenceFilms: [
			"La La Land dance sequences",
			"Beyonce - Lemonade",
			"The Weeknd - Blinding Lights",
		],
	},
];

const GENRE_PROFILES: CinematographyProfile[] = [
	{
		id: "family-warmth",
		name: "Family Warmth",
		nameEn: "Family Warmth",
		category: "genre",
		description:
			"Natural front light, warm 3200K, medium focus, stable tripod, warm as sunlight in a living room.",
		emoji: "\uD83C\uDFE0",
		defaultLighting: {
			style: "natural",
			direction: "front",
			colorTemperature: "warm",
		},
		defaultFocus: {
			depthOfField: "medium",
			focusTransition: "rack-between",
		},
		defaultRig: { cameraRig: "tripod", movementSpeed: "very-slow" },
		defaultAtmosphere: {
			effects: ["light-rays"],
			intensity: "subtle",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "50mm",
		promptGuidance:
			"Family drama cinematography is like a quiet observer. Stable tripod doesn't intrude, warm light like afternoon sun through windows. Medium focus keeps family members all visible in frame, conveying togetherness. Occasional god rays through windows add poetry to ordinary family scenes.",
		referenceFilms: ["Shoplifters", "Still Walking", "Reply 1988"],
	},
	{
		id: "action-intense",
		name: "Intense Action",
		nameEn: "Intense Action",
		category: "genre",
		description:
			"High-key side-lit, neutral tones, medium focus, fast shoulder-mounted, dust and sparks.",
		emoji: "\uD83D\uDCA5",
		defaultLighting: {
			style: "high-key",
			direction: "side",
			colorTemperature: "neutral",
		},
		defaultFocus: {
			depthOfField: "medium",
			focusTransition: "pull-focus",
		},
		defaultRig: { cameraRig: "shoulder", movementSpeed: "fast" },
		defaultAtmosphere: {
			effects: ["dust", "sparks"],
			intensity: "moderate",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "24mm",
		defaultTechnique: "high-speed",
		promptGuidance:
			"Action cinematography pursues kinetic energy transfer. Fast shoulder-mounted tracking makes viewers feel impact. Side light emphasizes muscle contours and action lines. Medium focus keeps subject sharp with moderate background blur. Key action moments (punches, explosions) use 0.5x slow-mo for power, then snap back to normal speed. Dust and sparks add physical collision realism.",
		referenceFilms: [
			"Mad Max: Fury Road",
			"The Bourne Identity",
			"The Raid",
			"Mission: Impossible",
		],
	},
	{
		id: "suspense-mystery",
		name: "Suspense Mystery",
		nameEn: "Suspense Mystery",
		category: "genre",
		description:
			"Low-key side-lit, cool tones, shallow focus, slow dolly push, subtle mist.",
		emoji: "\uD83D\uDD0D",
		defaultLighting: {
			style: "low-key",
			direction: "side",
			colorTemperature: "cool",
		},
		defaultFocus: {
			depthOfField: "shallow",
			focusTransition: "rack-to-fg",
		},
		defaultRig: { cameraRig: "dolly", movementSpeed: "very-slow" },
		defaultAtmosphere: { effects: ["mist"], intensity: "subtle" },
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "50mm",
		promptGuidance:
			"Suspense cinematography controls information reveal. Shallow focus selectively shows only what the director wants the audience to see. Very slow dolly push creates pressure. Low-key side light keeps half the frame in shadow. Rack focus is a key narrative tool: shift from foreground clue to background suspect, or reverse. Subtle mist adds ambiguity.",
		referenceFilms: [
			"Gone Girl",
			"Se7en",
			"Memories of Murder",
			"12 Angry Men",
		],
	},
];

const ERA_PROFILES: CinematographyProfile[] = [
	{
		id: "hk-retro-90s",
		name: "90s Hong Kong",
		nameEn: "90s Hong Kong",
		category: "era",
		description:
			"Neon side-lit, mixed color temp, medium focus, handheld sway, haze and smoke.",
		emoji: "\uD83C\uDF19",
		defaultLighting: {
			style: "neon",
			direction: "side",
			colorTemperature: "mixed",
		},
		defaultFocus: {
			depthOfField: "medium",
			focusTransition: "rack-between",
		},
		defaultRig: { cameraRig: "handheld", movementSpeed: "normal" },
		defaultAtmosphere: {
			effects: ["haze", "smoke"],
			intensity: "moderate",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "35mm",
		promptGuidance:
			"90s Hong Kong cinema DNA is neon streets plus handheld wandering. Mixed color temperature neon lights paint city streets in red-blue dreamscapes. Handheld camera weaves through crowds, occasionally using frame-skipping or step-printing for Wong Kar-wai-style ghosting. Haze-shrouded streets where every passerby seems to have a story. Side light outlines melancholic silhouettes.",
		referenceFilms: [
			"Chungking Express",
			"Fallen Angels",
			"Infernal Affairs",
			"A Better Tomorrow",
		],
	},
	{
		id: "golden-age-hollywood",
		name: "Golden Age Hollywood",
		nameEn: "Golden Age Hollywood",
		category: "era",
		description:
			"High-key three-point, warm tones, deep focus, elegant dolly, radiant and glamorous.",
		emoji: "\u2B50",
		defaultLighting: {
			style: "high-key",
			direction: "three-point",
			colorTemperature: "warm",
		},
		defaultFocus: { depthOfField: "deep", focusTransition: "none" },
		defaultRig: { cameraRig: "dolly", movementSpeed: "slow" },
		defaultAtmosphere: {
			effects: ["light-rays"],
			intensity: "subtle",
		},
		defaultSpeed: { playbackSpeed: "normal" },
		defaultAngle: "eye-level",
		defaultFocalLength: "50mm",
		promptGuidance:
			"Golden Age Hollywood pursued perfection. Three-point lighting eliminated every unflattering shadow, making stars glow. Deep focus and careful composition make every frame look like an oil painting. Dolly moves slowly and elegantly like a waltz. Warm color temperature gives the frame a nostalgic golden glow. Everything must be polished, glamorous, and flawless.",
		referenceFilms: [
			"Casablanca",
			"Citizen Kane",
			"Sunset Boulevard",
			"Gone with the Wind",
		],
	},
];

// ==================== Exports ====================

/** All cinematography profile presets */
export const CINEMATOGRAPHY_PROFILES: readonly CinematographyProfile[] = [
	...CINEMATIC_PROFILES,
	...DOCUMENTARY_PROFILES,
	...STYLIZED_PROFILES,
	...GENRE_PROFILES,
	...ERA_PROFILES,
] as const;

/** Profiles organized by category */
export const CINEMATOGRAPHY_PROFILE_CATEGORIES: {
	id: CinematographyCategory;
	name: string;
	emoji: string;
	profiles: readonly CinematographyProfile[];
}[] = [
	{
		id: "cinematic",
		name: "Cinematic",
		emoji: "\uD83C\uDFAC",
		profiles: CINEMATIC_PROFILES,
	},
	{
		id: "documentary",
		name: "Documentary",
		emoji: "\uD83D\uDCF9",
		profiles: DOCUMENTARY_PROFILES,
	},
	{
		id: "stylized",
		name: "Stylized",
		emoji: "\uD83C\uDFA8",
		profiles: STYLIZED_PROFILES,
	},
	{
		id: "genre",
		name: "Genre",
		emoji: "\uD83C\uDFAD",
		profiles: GENRE_PROFILES,
	},
	{
		id: "era",
		name: "Era",
		emoji: "\uD83D\uDCC5",
		profiles: ERA_PROFILES,
	},
];

/** Get profile by ID */
export function getCinematographyProfile(
	profileId: string
): CinematographyProfile | undefined {
	return CINEMATOGRAPHY_PROFILES.find((p) => p.id === profileId);
}

/** Default profile ID */
export const DEFAULT_CINEMATOGRAPHY_PROFILE_ID = "classic-cinematic";

/**
 * Build AI calibration cinematography guidance text.
 * Injected into system prompt as the default shooting baseline.
 */
export function buildCinematographyGuidance(profileId: string): string {
	const profile = getCinematographyProfile(profileId);
	if (!profile) return "";

	const {
		defaultLighting,
		defaultFocus,
		defaultRig,
		defaultAtmosphere,
		defaultSpeed,
	} = profile;

	const lines = [
		`[Cinematography Profile: ${profile.name} (${profile.nameEn})]`,
		`${profile.description}`,
		"",
		"**Default cinematography baseline (per-shot fields may deviate with narrative justification):**",
		`Lighting: ${defaultLighting.style} style + ${defaultLighting.direction} direction + ${defaultLighting.colorTemperature} color temp`,
		`Focus: ${defaultFocus.depthOfField} depth of field + ${defaultFocus.focusTransition} transition`,
		`Rig: ${defaultRig.cameraRig} + ${defaultRig.movementSpeed} speed`,
		defaultAtmosphere.effects.length > 0
			? `Atmosphere: ${defaultAtmosphere.effects.join("+")} (${defaultAtmosphere.intensity})`
			: "Atmosphere: none",
		`Speed: ${defaultSpeed.playbackSpeed}`,
		profile.defaultAngle ? `Angle: ${profile.defaultAngle}` : "",
		profile.defaultFocalLength
			? `Focal length: ${profile.defaultFocalLength}`
			: "",
		profile.defaultTechnique ? `Technique: ${profile.defaultTechnique}` : "",
		"",
		`**Guidance:** ${profile.promptGuidance}`,
		"",
		`**Reference films:** ${profile.referenceFilms.join(", ")}`,
	].filter(Boolean);

	return lines.join("\n");
}
