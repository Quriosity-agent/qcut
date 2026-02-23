/**
 * Lighting, Color Temperature, Atmospheric Effects, Focus, and Effect Intensity presets
 */

export const LIGHTING_STYLE_PRESETS = [
	{
		id: "high-key" as const,
		label: "High-Key",
		emoji: "\u2600\uFE0F",
		promptToken: "high-key lighting, bright and even,",
	},
	{
		id: "low-key" as const,
		label: "Low-Key",
		emoji: "\uD83C\uDF11",
		promptToken: "low-key lighting, dramatic shadows, film noir,",
	},
	{
		id: "silhouette" as const,
		label: "Silhouette",
		emoji: "\uD83C\uDF05",
		promptToken: "silhouette, backlit figure against bright background,",
	},
	{
		id: "chiaroscuro" as const,
		label: "Chiaroscuro",
		emoji: "\uD83C\uDFA8",
		promptToken: "chiaroscuro lighting, Rembrandt style, strong contrast,",
	},
	{
		id: "natural" as const,
		label: "Natural",
		emoji: "\uD83C\uDF24\uFE0F",
		promptToken: "natural lighting,",
	},
	{
		id: "neon" as const,
		label: "Neon",
		emoji: "\uD83D\uDC9C",
		promptToken: "neon lighting, vibrant colored lights,",
	},
	{
		id: "candlelight" as const,
		label: "Candlelight",
		emoji: "\uD83D\uDD6F\uFE0F",
		promptToken: "candlelight, warm dim golden glow,",
	},
	{
		id: "moonlight" as const,
		label: "Moonlight",
		emoji: "\uD83C\uDF19",
		promptToken: "moonlight, soft cold blue illumination,",
	},
] as const;

export const LIGHTING_DIRECTION_PRESETS = [
	{
		id: "front" as const,
		label: "Front",
		emoji: "\u2B06\uFE0F",
		promptToken: "front lighting,",
	},
	{
		id: "side" as const,
		label: "Side",
		emoji: "\u27A1\uFE0F",
		promptToken: "dramatic side lighting,",
	},
	{
		id: "back" as const,
		label: "Back",
		emoji: "\u2B07\uFE0F",
		promptToken: "backlit,",
	},
	{
		id: "top" as const,
		label: "Top",
		emoji: "\uD83D\uDD3D",
		promptToken: "overhead top lighting,",
	},
	{
		id: "bottom" as const,
		label: "Bottom",
		emoji: "\uD83D\uDD3C",
		promptToken: "underlighting, eerie,",
	},
	{
		id: "rim" as const,
		label: "Rim",
		emoji: "\uD83D\uDCAB",
		promptToken: "rim light, edge glow separating subject from background,",
	},
	{
		id: "three-point" as const,
		label: "Three-Point",
		emoji: "\uD83D\uDD3A",
		promptToken: "three-point lighting setup,",
	},
] as const;

export const COLOR_TEMPERATURE_PRESETS = [
	{
		id: "warm" as const,
		label: "Warm 3200K",
		emoji: "\uD83D\uDFE0",
		promptToken: "warm color temperature 3200K,",
	},
	{
		id: "neutral" as const,
		label: "Neutral 5500K",
		emoji: "\u26AA",
		promptToken: "neutral daylight 5500K,",
	},
	{
		id: "cool" as const,
		label: "Cool 7000K",
		emoji: "\uD83D\uDD35",
		promptToken: "cool blue color temperature,",
	},
	{
		id: "golden-hour" as const,
		label: "Golden Hour",
		emoji: "\uD83C\uDF07",
		promptToken: "golden hour warm sunlight,",
	},
	{
		id: "blue-hour" as const,
		label: "Blue Hour",
		emoji: "\uD83C\uDF06",
		promptToken: "blue hour twilight tones,",
	},
	{
		id: "mixed" as const,
		label: "Mixed",
		emoji: "\uD83C\uDFAD",
		promptToken: "mixed warm and cool lighting,",
	},
] as const;

export const DEPTH_OF_FIELD_PRESETS = [
	{
		id: "ultra-shallow" as const,
		label: "Ultra Shallow f/1.4",
		emoji: "\uD83D\uDD0D",
		promptToken: "extremely shallow depth of field, f/1.4, dreamy bokeh,",
	},
	{
		id: "shallow" as const,
		label: "Shallow f/2.8",
		emoji: "\uD83D\uDC64",
		promptToken: "shallow depth of field, soft background bokeh,",
	},
	{
		id: "medium" as const,
		label: "Medium f/5.6",
		emoji: "\uD83D\uDC65",
		promptToken: "medium depth of field,",
	},
	{
		id: "deep" as const,
		label: "Deep f/11",
		emoji: "\uD83C\uDFD4\uFE0F",
		promptToken: "deep focus, everything sharp,",
	},
	{
		id: "split-diopter" as const,
		label: "Split Diopter",
		emoji: "\uD83E\uDE9E",
		promptToken: "split diopter lens, foreground and background both in focus,",
	},
] as const;

export const FOCUS_TRANSITION_PRESETS = [
	{ id: "none" as const, label: "Fixed", promptToken: "" },
	{
		id: "rack-to-fg" as const,
		label: "Rack to FG",
		promptToken: "rack focus to foreground,",
	},
	{
		id: "rack-to-bg" as const,
		label: "Rack to BG",
		promptToken: "rack focus to background,",
	},
	{
		id: "rack-between" as const,
		label: "Rack Between",
		promptToken: "rack focus between characters,",
	},
	{
		id: "pull-focus" as const,
		label: "Pull Focus",
		promptToken: "pull focus following subject movement,",
	},
] as const;

export const ATMOSPHERIC_EFFECT_PRESETS = {
	weather: [
		{
			id: "rain" as const,
			label: "Rain",
			emoji: "\uD83C\uDF27\uFE0F",
			promptToken: "rain",
		},
		{
			id: "heavy-rain" as const,
			label: "Heavy Rain",
			emoji: "\u26C8\uFE0F",
			promptToken: "heavy rain pouring",
		},
		{
			id: "snow" as const,
			label: "Snow",
			emoji: "\u2744\uFE0F",
			promptToken: "snow falling",
		},
		{
			id: "blizzard" as const,
			label: "Blizzard",
			emoji: "\uD83C\uDF28\uFE0F",
			promptToken: "blizzard, heavy snowstorm",
		},
		{
			id: "fog" as const,
			label: "Fog",
			emoji: "\uD83C\uDF2B\uFE0F",
			promptToken: "dense fog",
		},
		{
			id: "mist" as const,
			label: "Mist",
			emoji: "\uD83C\uDF01",
			promptToken: "light mist",
		},
	],
	environment: [
		{
			id: "dust" as const,
			label: "Dust",
			emoji: "\uD83D\uDCA8",
			promptToken: "dust particles in air",
		},
		{
			id: "sandstorm" as const,
			label: "Sandstorm",
			emoji: "\uD83C\uDFDC\uFE0F",
			promptToken: "sandstorm",
		},
		{
			id: "smoke" as const,
			label: "Smoke",
			emoji: "\uD83D\uDCA8",
			promptToken: "smoke",
		},
		{
			id: "haze" as const,
			label: "Haze",
			emoji: "\uD83C\uDF2B\uFE0F",
			promptToken: "atmospheric haze",
		},
		{
			id: "fire" as const,
			label: "Fire",
			emoji: "\uD83D\uDD25",
			promptToken: "fire, flames",
		},
		{
			id: "sparks" as const,
			label: "Sparks",
			emoji: "\u2728",
			promptToken: "sparks flying",
		},
	],
	artistic: [
		{
			id: "lens-flare" as const,
			label: "Lens Flare",
			emoji: "\uD83C\uDF1F",
			promptToken: "lens flare",
		},
		{
			id: "light-rays" as const,
			label: "God Rays",
			emoji: "\uD83C\uDF05",
			promptToken: "god rays, light rays through atmosphere",
		},
		{
			id: "falling-leaves" as const,
			label: "Falling Leaves",
			emoji: "\uD83C\uDF42",
			promptToken: "falling leaves",
		},
		{
			id: "cherry-blossom" as const,
			label: "Cherry Blossom",
			emoji: "\uD83C\uDF38",
			promptToken: "cherry blossom petals floating",
		},
		{
			id: "fireflies" as const,
			label: "Fireflies",
			emoji: "\u2728",
			promptToken: "fireflies glowing",
		},
		{
			id: "particles" as const,
			label: "Particles",
			emoji: "\uD83D\uDCAB",
			promptToken: "floating particles",
		},
	],
} as const;

export const EFFECT_INTENSITY_PRESETS = [
	{ id: "subtle" as const, label: "Subtle", promptToken: "subtle" },
	{ id: "moderate" as const, label: "Moderate", promptToken: "" },
	{ id: "heavy" as const, label: "Heavy", promptToken: "heavy" },
] as const;
