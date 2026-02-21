/**
 * Director Panel Presets
 * Ported from moyin-creator
 *
 * All preset constants for shot composition:
 * shot sizes, camera angles, movements, lighting, effects, etc.
 */

// ==================== Shot Size ====================

export const SHOT_SIZE_PRESETS = [
	{ id: "ws", label: "Wide Shot", abbr: "WS", promptToken: "wide shot, establishing shot, distant view" },
	{ id: "ls", label: "Long Shot", abbr: "LS", promptToken: "long shot, full body shot" },
	{ id: "mls", label: "Medium Long Shot", abbr: "MLS", promptToken: "medium long shot, knee shot" },
	{ id: "ms", label: "Medium Shot", abbr: "MS", promptToken: "medium shot, waist shot" },
	{ id: "mcu", label: "Medium Close-Up", abbr: "MCU", promptToken: "medium close-up, chest shot" },
	{ id: "cu", label: "Close-Up", abbr: "CU", promptToken: "close-up, face shot" },
	{ id: "ecu", label: "Extreme Close-Up", abbr: "ECU", promptToken: "extreme close-up, detail shot" },
	{ id: "pov", label: "POV Shot", abbr: "POV", promptToken: "point of view shot, first person perspective" },
] as const;

export type ShotSizeType = (typeof SHOT_SIZE_PRESETS)[number]["id"];

// ==================== Duration ====================

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

// ==================== Sound Effects ====================

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
		{ id: "fighting", label: "Fighting", promptToken: "fighting impact sounds" },
		{ id: "running", label: "Running", promptToken: "running footsteps" },
	],
	atmosphere: [
		{ id: "suspense", label: "Suspense", promptToken: "suspenseful ambient sound" },
		{ id: "dramatic", label: "Dramatic", promptToken: "dramatic sound effect" },
		{ id: "peaceful", label: "Peaceful", promptToken: "peaceful ambient sound" },
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

// ==================== Lighting ====================

export const LIGHTING_STYLE_PRESETS = [
	{ id: "high-key" as const, label: "High-Key", emoji: "\u2600\uFE0F", promptToken: "high-key lighting, bright and even," },
	{ id: "low-key" as const, label: "Low-Key", emoji: "\uD83C\uDF11", promptToken: "low-key lighting, dramatic shadows, film noir," },
	{ id: "silhouette" as const, label: "Silhouette", emoji: "\uD83C\uDF05", promptToken: "silhouette, backlit figure against bright background," },
	{ id: "chiaroscuro" as const, label: "Chiaroscuro", emoji: "\uD83C\uDFA8", promptToken: "chiaroscuro lighting, Rembrandt style, strong contrast," },
	{ id: "natural" as const, label: "Natural", emoji: "\uD83C\uDF24\uFE0F", promptToken: "natural lighting," },
	{ id: "neon" as const, label: "Neon", emoji: "\uD83D\uDC9C", promptToken: "neon lighting, vibrant colored lights," },
	{ id: "candlelight" as const, label: "Candlelight", emoji: "\uD83D\uDD6F\uFE0F", promptToken: "candlelight, warm dim golden glow," },
	{ id: "moonlight" as const, label: "Moonlight", emoji: "\uD83C\uDF19", promptToken: "moonlight, soft cold blue illumination," },
] as const;

export const LIGHTING_DIRECTION_PRESETS = [
	{ id: "front" as const, label: "Front", emoji: "\u2B06\uFE0F", promptToken: "front lighting," },
	{ id: "side" as const, label: "Side", emoji: "\u27A1\uFE0F", promptToken: "dramatic side lighting," },
	{ id: "back" as const, label: "Back", emoji: "\u2B07\uFE0F", promptToken: "backlit," },
	{ id: "top" as const, label: "Top", emoji: "\uD83D\uDD3D", promptToken: "overhead top lighting," },
	{ id: "bottom" as const, label: "Bottom", emoji: "\uD83D\uDD3C", promptToken: "underlighting, eerie," },
	{ id: "rim" as const, label: "Rim", emoji: "\uD83D\uDCAB", promptToken: "rim light, edge glow separating subject from background," },
	{ id: "three-point" as const, label: "Three-Point", emoji: "\uD83D\uDD3A", promptToken: "three-point lighting setup," },
] as const;

export const COLOR_TEMPERATURE_PRESETS = [
	{ id: "warm" as const, label: "Warm 3200K", emoji: "\uD83D\uDFE0", promptToken: "warm color temperature 3200K," },
	{ id: "neutral" as const, label: "Neutral 5500K", emoji: "\u26AA", promptToken: "neutral daylight 5500K," },
	{ id: "cool" as const, label: "Cool 7000K", emoji: "\uD83D\uDD35", promptToken: "cool blue color temperature," },
	{ id: "golden-hour" as const, label: "Golden Hour", emoji: "\uD83C\uDF07", promptToken: "golden hour warm sunlight," },
	{ id: "blue-hour" as const, label: "Blue Hour", emoji: "\uD83C\uDF06", promptToken: "blue hour twilight tones," },
	{ id: "mixed" as const, label: "Mixed", emoji: "\uD83C\uDFAD", promptToken: "mixed warm and cool lighting," },
] as const;

// ==================== Focus ====================

export const DEPTH_OF_FIELD_PRESETS = [
	{ id: "ultra-shallow" as const, label: "Ultra Shallow f/1.4", emoji: "\uD83D\uDD0D", promptToken: "extremely shallow depth of field, f/1.4, dreamy bokeh," },
	{ id: "shallow" as const, label: "Shallow f/2.8", emoji: "\uD83D\uDC64", promptToken: "shallow depth of field, soft background bokeh," },
	{ id: "medium" as const, label: "Medium f/5.6", emoji: "\uD83D\uDC65", promptToken: "medium depth of field," },
	{ id: "deep" as const, label: "Deep f/11", emoji: "\uD83C\uDFD4\uFE0F", promptToken: "deep focus, everything sharp," },
	{ id: "split-diopter" as const, label: "Split Diopter", emoji: "\uD83E\uDE9E", promptToken: "split diopter lens, foreground and background both in focus," },
] as const;

export const FOCUS_TRANSITION_PRESETS = [
	{ id: "none" as const, label: "Fixed", promptToken: "" },
	{ id: "rack-to-fg" as const, label: "Rack to FG", promptToken: "rack focus to foreground," },
	{ id: "rack-to-bg" as const, label: "Rack to BG", promptToken: "rack focus to background," },
	{ id: "rack-between" as const, label: "Rack Between", promptToken: "rack focus between characters," },
	{ id: "pull-focus" as const, label: "Pull Focus", promptToken: "pull focus following subject movement," },
] as const;

// ==================== Camera Rig ====================

export const CAMERA_RIG_PRESETS = [
	{ id: "tripod" as const, label: "Tripod", emoji: "\uD83D\uDCD0", promptToken: "static tripod shot," },
	{ id: "handheld" as const, label: "Handheld", emoji: "\uD83E\uDD32", promptToken: "handheld camera, slight shake, documentary feel," },
	{ id: "steadicam" as const, label: "Steadicam", emoji: "\uD83C\uDFA5", promptToken: "smooth steadicam shot," },
	{ id: "dolly" as const, label: "Dolly", emoji: "\uD83D\uDEE4\uFE0F", promptToken: "dolly tracking shot, smooth rail movement," },
	{ id: "crane" as const, label: "Crane", emoji: "\uD83C\uDFD7\uFE0F", promptToken: "crane shot, sweeping vertical movement," },
	{ id: "drone" as const, label: "Drone", emoji: "\uD83D\uDE81", promptToken: "aerial drone shot, bird's eye perspective," },
	{ id: "shoulder" as const, label: "Shoulder", emoji: "\uD83D\uDCAA", promptToken: "shoulder-mounted camera, subtle movement," },
	{ id: "slider" as const, label: "Slider", emoji: "\u2194\uFE0F", promptToken: "slider shot, short smooth lateral movement," },
] as const;

export const MOVEMENT_SPEED_PRESETS = [
	{ id: "very-slow" as const, label: "Very Slow", promptToken: "very slow camera movement," },
	{ id: "slow" as const, label: "Slow", promptToken: "slow camera movement," },
	{ id: "normal" as const, label: "Normal", promptToken: "" },
	{ id: "fast" as const, label: "Fast", promptToken: "fast camera movement," },
	{ id: "very-fast" as const, label: "Very Fast", promptToken: "very fast camera movement," },
] as const;

// ==================== Atmospheric Effects ====================

export const ATMOSPHERIC_EFFECT_PRESETS = {
	weather: [
		{ id: "rain" as const, label: "Rain", emoji: "\uD83C\uDF27\uFE0F", promptToken: "rain" },
		{ id: "heavy-rain" as const, label: "Heavy Rain", emoji: "\u26C8\uFE0F", promptToken: "heavy rain pouring" },
		{ id: "snow" as const, label: "Snow", emoji: "\u2744\uFE0F", promptToken: "snow falling" },
		{ id: "blizzard" as const, label: "Blizzard", emoji: "\uD83C\uDF28\uFE0F", promptToken: "blizzard, heavy snowstorm" },
		{ id: "fog" as const, label: "Fog", emoji: "\uD83C\uDF2B\uFE0F", promptToken: "dense fog" },
		{ id: "mist" as const, label: "Mist", emoji: "\uD83C\uDF01", promptToken: "light mist" },
	],
	environment: [
		{ id: "dust" as const, label: "Dust", emoji: "\uD83D\uDCA8", promptToken: "dust particles in air" },
		{ id: "sandstorm" as const, label: "Sandstorm", emoji: "\uD83C\uDFDC\uFE0F", promptToken: "sandstorm" },
		{ id: "smoke" as const, label: "Smoke", emoji: "\uD83D\uDCA8", promptToken: "smoke" },
		{ id: "haze" as const, label: "Haze", emoji: "\uD83C\uDF2B\uFE0F", promptToken: "atmospheric haze" },
		{ id: "fire" as const, label: "Fire", emoji: "\uD83D\uDD25", promptToken: "fire, flames" },
		{ id: "sparks" as const, label: "Sparks", emoji: "\u2728", promptToken: "sparks flying" },
	],
	artistic: [
		{ id: "lens-flare" as const, label: "Lens Flare", emoji: "\uD83C\uDF1F", promptToken: "lens flare" },
		{ id: "light-rays" as const, label: "God Rays", emoji: "\uD83C\uDF05", promptToken: "god rays, light rays through atmosphere" },
		{ id: "falling-leaves" as const, label: "Falling Leaves", emoji: "\uD83C\uDF42", promptToken: "falling leaves" },
		{ id: "cherry-blossom" as const, label: "Cherry Blossom", emoji: "\uD83C\uDF38", promptToken: "cherry blossom petals floating" },
		{ id: "fireflies" as const, label: "Fireflies", emoji: "\u2728", promptToken: "fireflies glowing" },
		{ id: "particles" as const, label: "Particles", emoji: "\uD83D\uDCAB", promptToken: "floating particles" },
	],
} as const;

export const EFFECT_INTENSITY_PRESETS = [
	{ id: "subtle" as const, label: "Subtle", promptToken: "subtle" },
	{ id: "moderate" as const, label: "Moderate", promptToken: "" },
	{ id: "heavy" as const, label: "Heavy", promptToken: "heavy" },
] as const;

// ==================== Playback Speed ====================

export const PLAYBACK_SPEED_PRESETS = [
	{ id: "slow-motion-4x" as const, label: "Super Slow 0.25x", emoji: "\uD83D\uDC0C", promptToken: "ultra slow motion, 120fps," },
	{ id: "slow-motion-2x" as const, label: "Slow Mo 0.5x", emoji: "\uD83D\uDC22", promptToken: "slow motion, 60fps," },
	{ id: "normal" as const, label: "Normal 1x", emoji: "\u25B6\uFE0F", promptToken: "" },
	{ id: "fast-2x" as const, label: "Fast 2x", emoji: "\u23E9", promptToken: "fast motion, sped up," },
	{ id: "timelapse" as const, label: "Timelapse", emoji: "\u23F1\uFE0F", promptToken: "timelapse, time passing rapidly," },
] as const;

// ==================== Camera Movement ====================

export const CAMERA_MOVEMENT_PRESETS = [
	{ id: "none" as const, label: "None", promptToken: "" },
	{ id: "static" as const, label: "Static", promptToken: "static camera, locked off," },
	{ id: "tracking" as const, label: "Tracking", promptToken: "tracking shot, following subject," },
	{ id: "orbit" as const, label: "Orbit", promptToken: "orbiting around subject, circular camera movement," },
	{ id: "zoom-in" as const, label: "Zoom In", promptToken: "zoom in, lens zooming closer," },
	{ id: "zoom-out" as const, label: "Zoom Out", promptToken: "zoom out, lens zooming wider," },
	{ id: "pan-left" as const, label: "Pan Left", promptToken: "pan left, horizontal camera rotation left," },
	{ id: "pan-right" as const, label: "Pan Right", promptToken: "pan right, horizontal camera rotation right," },
	{ id: "tilt-up" as const, label: "Tilt Up", promptToken: "tilt up, camera tilting upward," },
	{ id: "tilt-down" as const, label: "Tilt Down", promptToken: "tilt down, camera tilting downward," },
	{ id: "dolly-in" as const, label: "Dolly In", promptToken: "dolly in, camera pushing forward," },
	{ id: "dolly-out" as const, label: "Dolly Out", promptToken: "dolly out, camera pulling back," },
	{ id: "truck-left" as const, label: "Truck Left", promptToken: "truck left, lateral camera movement left," },
	{ id: "truck-right" as const, label: "Truck Right", promptToken: "truck right, lateral camera movement right," },
	{ id: "crane-up" as const, label: "Crane Up", promptToken: "crane up, camera ascending vertically," },
	{ id: "crane-down" as const, label: "Crane Down", promptToken: "crane down, camera descending vertically," },
	{ id: "drone-aerial" as const, label: "Drone Aerial", promptToken: "drone aerial shot, sweeping aerial movement," },
	{ id: "360-roll" as const, label: "360 Roll", promptToken: "360 degree barrel roll, rotating camera," },
] as const;

export type CameraMovementType = (typeof CAMERA_MOVEMENT_PRESETS)[number]["id"];

// ==================== Special Techniques ====================

export const SPECIAL_TECHNIQUE_PRESETS = [
	{ id: "none" as const, label: "None", promptToken: "" },
	{ id: "hitchcock-zoom" as const, label: "Hitchcock Zoom", promptToken: "dolly zoom, vertigo effect, Hitchcock zoom," },
	{ id: "timelapse" as const, label: "Timelapse", promptToken: "timelapse, time passing rapidly," },
	{ id: "crash-zoom-in" as const, label: "Crash Zoom In", promptToken: "crash zoom in, sudden rapid zoom," },
	{ id: "crash-zoom-out" as const, label: "Crash Zoom Out", promptToken: "crash zoom out, sudden rapid pull back," },
	{ id: "whip-pan" as const, label: "Whip Pan", promptToken: "whip pan, fast swish pan, motion blur transition," },
	{ id: "bullet-time" as const, label: "Bullet Time", promptToken: "bullet time, frozen time orbit shot, ultra slow motion," },
	{ id: "fpv-shuttle" as const, label: "FPV Shuttle", promptToken: "FPV drone shuttle, first person flight through scene," },
	{ id: "macro-closeup" as const, label: "Macro Close-up", promptToken: "macro extreme close-up, intricate detail shot," },
	{ id: "first-person" as const, label: "First Person", promptToken: "first person POV shot, subjective camera," },
	{ id: "slow-motion" as const, label: "Slow Motion", promptToken: "slow motion, dramatic slow mo, high frame rate," },
	{ id: "probe-lens" as const, label: "Probe Lens", promptToken: "probe lens shot, snorkel camera, macro perspective movement," },
	{ id: "spinning-tilt" as const, label: "Spinning Tilt", promptToken: "spinning tilting camera, disorienting rotation," },
] as const;

export type SpecialTechniqueType = (typeof SPECIAL_TECHNIQUE_PRESETS)[number]["id"];

// ==================== Emotion Presets ====================

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

// ==================== Camera Angle ====================

export const CAMERA_ANGLE_PRESETS = [
	{ id: "eye-level" as const, label: "Eye Level", emoji: "\uD83D\uDC41\uFE0F", promptToken: "eye level angle," },
	{ id: "high-angle" as const, label: "High Angle", emoji: "\u2B07\uFE0F", promptToken: "high angle shot, looking down," },
	{ id: "low-angle" as const, label: "Low Angle", emoji: "\u2B06\uFE0F", promptToken: "low angle shot, looking up, heroic perspective," },
	{ id: "birds-eye" as const, label: "Bird's Eye", emoji: "\uD83E\uDD85", promptToken: "bird's eye view, top-down overhead shot," },
	{ id: "worms-eye" as const, label: "Worm's Eye", emoji: "\uD83D\uDC1B", promptToken: "worm's eye view, extreme low angle from ground," },
	{ id: "over-shoulder" as const, label: "Over Shoulder", emoji: "\uD83E\uDEF2", promptToken: "over the shoulder shot, OTS," },
	{ id: "side-angle" as const, label: "Side Angle", emoji: "\u2194\uFE0F", promptToken: "side angle, profile view," },
	{ id: "dutch-angle" as const, label: "Dutch Angle", emoji: "\uD83D\uDCD0", promptToken: "dutch angle, tilted frame, canted angle," },
	{ id: "third-person" as const, label: "Third Person", emoji: "\uD83C\uDFAE", promptToken: "third person perspective, slightly behind and above subject," },
] as const;

export type CameraAngleType = (typeof CAMERA_ANGLE_PRESETS)[number]["id"];

// ==================== Focal Length ====================

export const FOCAL_LENGTH_PRESETS = [
	{ id: "8mm" as const, label: "8mm Fisheye", emoji: "\uD83D\uDC1F", promptToken: "8mm fisheye lens, extreme barrel distortion, ultra wide field of view," },
	{ id: "14mm" as const, label: "14mm Ultra Wide", emoji: "\uD83C\uDF10", promptToken: "14mm ultra wide angle lens, dramatic perspective distortion," },
	{ id: "24mm" as const, label: "24mm Wide", emoji: "\uD83C\uDFD4\uFE0F", promptToken: "24mm wide angle lens, environmental context, slight perspective exaggeration," },
	{ id: "35mm" as const, label: "35mm Standard Wide", emoji: "\uD83D\uDCF7", promptToken: "35mm lens, natural wide perspective, street photography feel," },
	{ id: "50mm" as const, label: "50mm Standard", emoji: "\uD83D\uDC41\uFE0F", promptToken: "50mm standard lens, natural human eye perspective," },
	{ id: "85mm" as const, label: "85mm Portrait", emoji: "\uD83E\uDDD1", promptToken: "85mm portrait lens, flattering facial proportions, smooth background compression," },
	{ id: "105mm" as const, label: "105mm Medium Tele", emoji: "\uD83D\uDD2D", promptToken: "105mm medium telephoto, gentle background compression," },
	{ id: "135mm" as const, label: "135mm Telephoto", emoji: "\uD83D\uDCE1", promptToken: "135mm telephoto lens, strong background compression, subject isolation," },
	{ id: "200mm" as const, label: "200mm Long Tele", emoji: "\uD83D\uDD2C", promptToken: "200mm telephoto, extreme background compression, flattened perspective," },
	{ id: "400mm" as const, label: "400mm Super Tele", emoji: "\uD83D\uDEF0\uFE0F", promptToken: "400mm super telephoto, extreme compression, distant subject isolation," },
] as const;

export type FocalLengthType = (typeof FOCAL_LENGTH_PRESETS)[number]["id"];

// ==================== Photography Technique ====================

export const PHOTOGRAPHY_TECHNIQUE_PRESETS = [
	{ id: "long-exposure" as const, label: "Long Exposure", emoji: "\uD83C\uDF0A", promptToken: "long exposure, motion blur, light trails, smooth water," },
	{ id: "double-exposure" as const, label: "Double Exposure", emoji: "\uD83D\uDC65", promptToken: "double exposure, overlapping images, ghostly transparency effect," },
	{ id: "macro" as const, label: "Macro", emoji: "\uD83D\uDD0D", promptToken: "macro photography, extreme close-up, intricate details visible," },
	{ id: "tilt-shift" as const, label: "Tilt-Shift", emoji: "\uD83C\uDFD8\uFE0F", promptToken: "tilt-shift photography, miniature effect, selective focus plane," },
	{ id: "high-speed" as const, label: "High Speed Freeze", emoji: "\u26A1", promptToken: "high speed photography, frozen motion, sharp action freeze frame," },
	{ id: "bokeh" as const, label: "Bokeh", emoji: "\uD83D\uDCAB", promptToken: "beautiful bokeh, creamy out-of-focus highlights, dreamy background blur," },
	{ id: "reflection" as const, label: "Reflection", emoji: "\uD83E\uDE9E", promptToken: "reflection photography, mirror surface, symmetrical composition," },
	{ id: "silhouette-technique" as const, label: "Silhouette", emoji: "\uD83C\uDF05", promptToken: "silhouette photography, dark figure against bright background, rim light outline," },
] as const;

export type PhotographyTechniqueType = (typeof PHOTOGRAPHY_TECHNIQUE_PRESETS)[number]["id"];
