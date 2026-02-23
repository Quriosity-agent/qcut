/**
 * Special Techniques, Photography Techniques, Emotions, Playback Speed,
 * Sound Effects, and Duration presets
 */

export const DURATION_PRESETS = [
	{ id: 4, label: "4s", value: 4 },
	{ id: 5, label: "5s", value: 5 },
	{ id: 6, label: "6s", value: 6 },
	{ id: 7, label: "7s", value: 7 },
	{ id: 8, label: "8s", value: 8 },
	{ id: 9, label: "9s", value: 9 },
	{ id: 10, label: "10s", value: 10 },
	{ id: 11, label: "11s", value: 11 },
	{ id: 12, label: "12s", value: 12 },
] as const;

export const SOUND_EFFECT_PRESETS = {
	nature: [
		{ id: "wind", label: "Wind", promptToken: "wind blowing sound" },
		{ id: "rain", label: "Rain", promptToken: "rain falling sound" },
		{ id: "thunder", label: "Thunder", promptToken: "thunder rumbling" },
		{ id: "birds", label: "Birds", promptToken: "birds chirping" },
		{ id: "water", label: "Water", promptToken: "water flowing sound" },
		{ id: "waves", label: "Waves", promptToken: "ocean waves crashing" },
	],
	action: [
		{ id: "footsteps", label: "Footsteps", promptToken: "footsteps sound" },
		{ id: "breathing", label: "Breathing", promptToken: "heavy breathing" },
		{ id: "heartbeat", label: "Heartbeat", promptToken: "heartbeat pounding" },
		{
			id: "fighting",
			label: "Fighting",
			promptToken: "fighting impact sounds",
		},
		{ id: "running", label: "Running", promptToken: "running footsteps" },
	],
	atmosphere: [
		{
			id: "suspense",
			label: "Suspense",
			promptToken: "suspenseful ambient sound",
		},
		{ id: "dramatic", label: "Dramatic", promptToken: "dramatic sound effect" },
		{
			id: "peaceful",
			label: "Peaceful",
			promptToken: "peaceful ambient sound",
		},
		{ id: "tense", label: "Tense", promptToken: "tense atmosphere sound" },
		{ id: "epic", label: "Epic", promptToken: "epic cinematic sound" },
	],
	urban: [
		{ id: "traffic", label: "Traffic", promptToken: "traffic noise" },
		{ id: "crowd", label: "Crowd", promptToken: "crowd murmuring" },
		{ id: "siren", label: "Siren", promptToken: "siren wailing" },
		{ id: "horn", label: "Horn", promptToken: "car horn honking" },
	],
} as const;

export const PLAYBACK_SPEED_PRESETS = [
	{
		id: "slow-motion-4x" as const,
		label: "Super Slow 0.25x",
		emoji: "\uD83D\uDC0C",
		promptToken: "ultra slow motion, 120fps,",
	},
	{
		id: "slow-motion-2x" as const,
		label: "Slow Mo 0.5x",
		emoji: "\uD83D\uDC22",
		promptToken: "slow motion, 60fps,",
	},
	{
		id: "normal" as const,
		label: "Normal 1x",
		emoji: "\u25B6\uFE0F",
		promptToken: "",
	},
	{
		id: "fast-2x" as const,
		label: "Fast 2x",
		emoji: "\u23E9",
		promptToken: "fast motion, sped up,",
	},
	{
		id: "timelapse" as const,
		label: "Timelapse",
		emoji: "\u23F1\uFE0F",
		promptToken: "timelapse, time passing rapidly,",
	},
] as const;

export const SPECIAL_TECHNIQUE_PRESETS = [
	{ id: "none" as const, label: "None", promptToken: "" },
	{
		id: "hitchcock-zoom" as const,
		label: "Hitchcock Zoom",
		promptToken: "dolly zoom, vertigo effect, Hitchcock zoom,",
	},
	{
		id: "timelapse" as const,
		label: "Timelapse",
		promptToken: "timelapse, time passing rapidly,",
	},
	{
		id: "crash-zoom-in" as const,
		label: "Crash Zoom In",
		promptToken: "crash zoom in, sudden rapid zoom,",
	},
	{
		id: "crash-zoom-out" as const,
		label: "Crash Zoom Out",
		promptToken: "crash zoom out, sudden rapid pull back,",
	},
	{
		id: "whip-pan" as const,
		label: "Whip Pan",
		promptToken: "whip pan, fast swish pan, motion blur transition,",
	},
	{
		id: "bullet-time" as const,
		label: "Bullet Time",
		promptToken: "bullet time, frozen time orbit shot, ultra slow motion,",
	},
	{
		id: "fpv-shuttle" as const,
		label: "FPV Shuttle",
		promptToken: "FPV drone shuttle, first person flight through scene,",
	},
	{
		id: "macro-closeup" as const,
		label: "Macro Close-up",
		promptToken: "macro extreme close-up, intricate detail shot,",
	},
	{
		id: "first-person" as const,
		label: "First Person",
		promptToken: "first person POV shot, subjective camera,",
	},
	{
		id: "slow-motion" as const,
		label: "Slow Motion",
		promptToken: "slow motion, dramatic slow mo, high frame rate,",
	},
	{
		id: "probe-lens" as const,
		label: "Probe Lens",
		promptToken: "probe lens shot, snorkel camera, macro perspective movement,",
	},
	{
		id: "spinning-tilt" as const,
		label: "Spinning Tilt",
		promptToken: "spinning tilting camera, disorienting rotation,",
	},
] as const;

export type SpecialTechniqueType =
	(typeof SPECIAL_TECHNIQUE_PRESETS)[number]["id"];

export const EMOTION_PRESETS = {
	basic: [
		{ id: "happy", label: "Happy", emoji: "\uD83D\uDE0A" },
		{ id: "sad", label: "Sad", emoji: "\uD83D\uDE22" },
		{ id: "angry", label: "Angry", emoji: "\uD83D\uDE20" },
		{ id: "surprised", label: "Surprised", emoji: "\uD83D\uDE32" },
		{ id: "fearful", label: "Fearful", emoji: "\uD83D\uDE28" },
		{ id: "calm", label: "Calm", emoji: "\uD83D\uDE10" },
	],
	atmosphere: [
		{ id: "tense", label: "Tense", emoji: "\uD83D\uDE30" },
		{ id: "excited", label: "Excited", emoji: "\uD83E\uDD29" },
		{ id: "mysterious", label: "Mysterious", emoji: "\uD83E\uDD14" },
		{ id: "romantic", label: "Romantic", emoji: "\uD83E\uDD70" },
		{ id: "funny", label: "Funny", emoji: "\uD83D\uDE02" },
		{ id: "touching", label: "Touching", emoji: "\uD83E\uDD79" },
	],
	tone: [
		{ id: "serious", label: "Serious", emoji: "\uD83D\uDE11" },
		{ id: "relaxed", label: "Relaxed", emoji: "\uD83D\uDE0C" },
		{ id: "playful", label: "Playful", emoji: "\uD83D\uDE1C" },
		{ id: "gentle", label: "Gentle", emoji: "\uD83D\uDE07" },
		{ id: "passionate", label: "Passionate", emoji: "\uD83D\uDD25" },
		{ id: "low", label: "Somber", emoji: "\uD83D\uDE14" },
	],
} as const;

export type EmotionTag =
	| (typeof EMOTION_PRESETS.basic)[number]["id"]
	| (typeof EMOTION_PRESETS.atmosphere)[number]["id"]
	| (typeof EMOTION_PRESETS.tone)[number]["id"];

export const PHOTOGRAPHY_TECHNIQUE_PRESETS = [
	{
		id: "long-exposure" as const,
		label: "Long Exposure",
		emoji: "\uD83C\uDF0A",
		promptToken: "long exposure, motion blur, light trails, smooth water,",
	},
	{
		id: "double-exposure" as const,
		label: "Double Exposure",
		emoji: "\uD83D\uDC65",
		promptToken:
			"double exposure, overlapping images, ghostly transparency effect,",
	},
	{
		id: "macro" as const,
		label: "Macro",
		emoji: "\uD83D\uDD0D",
		promptToken:
			"macro photography, extreme close-up, intricate details visible,",
	},
	{
		id: "tilt-shift" as const,
		label: "Tilt-Shift",
		emoji: "\uD83C\uDFD8\uFE0F",
		promptToken:
			"tilt-shift photography, miniature effect, selective focus plane,",
	},
	{
		id: "high-speed" as const,
		label: "High Speed Freeze",
		emoji: "\u26A1",
		promptToken:
			"high speed photography, frozen motion, sharp action freeze frame,",
	},
	{
		id: "bokeh" as const,
		label: "Bokeh",
		emoji: "\uD83D\uDCAB",
		promptToken:
			"beautiful bokeh, creamy out-of-focus highlights, dreamy background blur,",
	},
	{
		id: "reflection" as const,
		label: "Reflection",
		emoji: "\uD83E\uDE9E",
		promptToken:
			"reflection photography, mirror surface, symmetrical composition,",
	},
	{
		id: "silhouette-technique" as const,
		label: "Silhouette",
		emoji: "\uD83C\uDF05",
		promptToken:
			"silhouette photography, dark figure against bright background, rim light outline,",
	},
] as const;

export type PhotographyTechniqueType =
	(typeof PHOTOGRAPHY_TECHNIQUE_PRESETS)[number]["id"];
