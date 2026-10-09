import { describe, expect, it } from "vitest";
import {
	buildCinematographyGuidance,
	CINEMATOGRAPHY_CATEGORIES,
	CINEMATOGRAPHY_PROFILE_CATEGORIES,
	CINEMATOGRAPHY_PROFILES,
	DEFAULT_CINEMATOGRAPHY_PROFILE_ID,
	getCinematographyProfile,
} from "../cinematography-profiles";
import type { CinematographyProfile } from "../cinematography-profiles";
import {
	DEFAULT_STYLE_ID,
	getMediaType,
	getStyleById,
	getStyleDescription,
	getStyleName,
	getStyleNegativePrompt,
	getStylePrompt,
	getStylesByCategory,
	STYLE_CATEGORIES,
	VISUAL_STYLE_PRESETS,
} from "../visual-styles";
import type { StylePreset } from "../visual-styles";

// ============================================================
// cinematography-profiles.ts
// ============================================================

describe("cinematography-profiles", () => {
	it("CINEMATOGRAPHY_PROFILES has 16 profiles", () => {
		expect(CINEMATOGRAPHY_PROFILES).toHaveLength(16);
	});

	it("each profile has all required fields", () => {
		const requiredStringFields: (keyof CinematographyProfile)[] = [
			"id",
			"name",
			"nameEn",
			"category",
			"description",
			"emoji",
			"promptGuidance",
		];

		for (const profile of CINEMATOGRAPHY_PROFILES) {
			for (const field of requiredStringFields) {
				expect(profile[field], `${profile.id} missing ${field}`).toBeTruthy();
			}

			// Nested required objects
			expect(profile.defaultLighting).toBeDefined();
			expect(profile.defaultLighting.style).toBeTruthy();
			expect(profile.defaultLighting.direction).toBeTruthy();
			expect(profile.defaultLighting.colorTemperature).toBeTruthy();

			expect(profile.defaultFocus).toBeDefined();
			expect(profile.defaultFocus.depthOfField).toBeTruthy();
			expect(profile.defaultFocus.focusTransition).toBeTruthy();

			expect(profile.defaultRig).toBeDefined();
			expect(profile.defaultRig.cameraRig).toBeTruthy();
			expect(profile.defaultRig.movementSpeed).toBeTruthy();

			expect(profile.defaultAtmosphere).toBeDefined();
			expect(Array.isArray(profile.defaultAtmosphere.effects)).toBe(true);
			expect(profile.defaultAtmosphere.intensity).toBeTruthy();

			expect(profile.defaultSpeed).toBeDefined();
			expect(profile.defaultSpeed.playbackSpeed).toBeTruthy();

			// referenceFilms must be a non-empty array
			expect(Array.isArray(profile.referenceFilms)).toBe(true);
			expect(profile.referenceFilms.length).toBeGreaterThan(0);
		}
	});

	it("getCinematographyProfile() returns the correct profile by ID", () => {
		const profile = getCinematographyProfile("film-noir");
		expect(profile).toBeDefined();
		expect(profile?.id).toBe("film-noir");
		expect(profile?.name).toBe("Film Noir");
	});

	it("getCinematographyProfile() returns undefined for unknown ID", () => {
		const profile = getCinematographyProfile("non-existent-profile");
		expect(profile).toBeUndefined();
	});

	it('DEFAULT_CINEMATOGRAPHY_PROFILE_ID is "classic-cinematic"', () => {
		expect(DEFAULT_CINEMATOGRAPHY_PROFILE_ID).toBe("classic-cinematic");
	});

	it("default profile ID points to a valid profile", () => {
		const profile = getCinematographyProfile(DEFAULT_CINEMATOGRAPHY_PROFILE_ID);
		expect(profile).toBeDefined();
		expect(profile?.id).toBe(DEFAULT_CINEMATOGRAPHY_PROFILE_ID);
	});

	it("CINEMATOGRAPHY_CATEGORIES has 5 categories", () => {
		expect(CINEMATOGRAPHY_CATEGORIES).toHaveLength(5);
	});

	it("CINEMATOGRAPHY_CATEGORIES contains the expected category IDs", () => {
		const ids = CINEMATOGRAPHY_CATEGORIES.map((c) => c.id);
		expect(ids).toContain("cinematic");
		expect(ids).toContain("documentary");
		expect(ids).toContain("stylized");
		expect(ids).toContain("genre");
		expect(ids).toContain("era");
	});

	it("each category entry has id, name, and emoji", () => {
		for (const cat of CINEMATOGRAPHY_CATEGORIES) {
			expect(cat.id).toBeTruthy();
			expect(cat.name).toBeTruthy();
			expect(cat.emoji).toBeTruthy();
		}
	});

	it("CINEMATOGRAPHY_PROFILE_CATEGORIES maps correctly to categories", () => {
		expect(CINEMATOGRAPHY_PROFILE_CATEGORIES).toHaveLength(5);

		const catIds = CINEMATOGRAPHY_PROFILE_CATEGORIES.map((c) => c.id);
		expect(catIds).toEqual([
			"cinematic",
			"documentary",
			"stylized",
			"genre",
			"era",
		]);

		// Each category group should have at least one profile
		for (const group of CINEMATOGRAPHY_PROFILE_CATEGORIES) {
			expect(group.profiles.length).toBeGreaterThan(0);
			expect(group.name).toBeTruthy();
			expect(group.emoji).toBeTruthy();
		}
	});

	it("CINEMATOGRAPHY_PROFILE_CATEGORIES profiles match their category", () => {
		for (const group of CINEMATOGRAPHY_PROFILE_CATEGORIES) {
			for (const profile of group.profiles) {
				expect(profile.category).toBe(group.id);
			}
		}
	});

	it("all profile IDs are unique", () => {
		const ids = CINEMATOGRAPHY_PROFILES.map((p) => p.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});

describe("buildCinematographyGuidance", () => {
	it("returns a formatted guidance string containing profile name", () => {
		const guidance = buildCinematographyGuidance("classic-cinematic");
		expect(guidance).toContain("Classic Cinematic");
	});

	it("includes the promptGuidance text", () => {
		const profile = getCinematographyProfile("classic-cinematic");
		if (!profile) throw new Error("Expected profile to be defined");

		const guidance = buildCinematographyGuidance("classic-cinematic");
		expect(guidance).toContain(profile.promptGuidance);
	});

	it("includes reference films", () => {
		const guidance = buildCinematographyGuidance("classic-cinematic");
		expect(guidance).toContain("Reference films");
		expect(guidance).toContain("The Shawshank Redemption");
	});

	it("includes lighting, focus, and rig details", () => {
		const guidance = buildCinematographyGuidance("classic-cinematic");
		expect(guidance).toContain("Lighting:");
		expect(guidance).toContain("Focus:");
		expect(guidance).toContain("Rig:");
	});

	it("includes atmosphere when profile has effects", () => {
		const guidance = buildCinematographyGuidance("film-noir");
		expect(guidance).toContain("Atmosphere:");
		expect(guidance).toContain("fog");
	});

	it('shows "Atmosphere: none" when profile has no effects', () => {
		const guidance = buildCinematographyGuidance("classic-cinematic");
		expect(guidance).toContain("Atmosphere: none");
	});

	it("returns empty string for unknown profile ID", () => {
		const guidance = buildCinematographyGuidance("does-not-exist");
		expect(guidance).toBe("");
	});

	it("includes optional angle and focal length when present", () => {
		const guidance = buildCinematographyGuidance("classic-cinematic");
		expect(guidance).toContain("Angle: eye-level");
		expect(guidance).toContain("Focal length: 50mm");
	});

	it("includes optional technique when present", () => {
		const guidance = buildCinematographyGuidance("romantic-film");
		expect(guidance).toContain("Technique: bokeh");
	});
});

// ============================================================
// visual-styles.ts
// ============================================================

describe("visual-styles", () => {
	it("VISUAL_STYLE_PRESETS is a non-empty array", () => {
		expect(Array.isArray(VISUAL_STYLE_PRESETS)).toBe(true);
		expect(VISUAL_STYLE_PRESETS.length).toBeGreaterThan(0);
	});

	it("each preset has all required fields", () => {
		const requiredFields: (keyof StylePreset)[] = [
			"id",
			"name",
			"category",
			"mediaType",
			"prompt",
			"negativePrompt",
			"description",
		];

		for (const preset of VISUAL_STYLE_PRESETS) {
			for (const field of requiredFields) {
				expect(preset[field], `${preset.id} missing ${field}`).toBeTruthy();
			}
		}
	});

	it("all preset IDs are unique", () => {
		const ids = VISUAL_STYLE_PRESETS.map((s) => s.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it("getStyleById() returns the correct style by ID", () => {
		const style = getStyleById("3d_xuanhuan");
		expect(style).toBeDefined();
		expect(style?.id).toBe("3d_xuanhuan");
		expect(style?.name).toBe("3D Xuanhuan");
	});

	it("getStyleById() returns undefined for unknown ID", () => {
		const style = getStyleById("non_existent_style");
		expect(style).toBeUndefined();
	});

	it('DEFAULT_STYLE_ID is "2d_ghibli"', () => {
		expect(DEFAULT_STYLE_ID).toBe("2d_ghibli");
	});

	it("DEFAULT_STYLE_ID points to a valid style", () => {
		const style = getStyleById(DEFAULT_STYLE_ID);
		expect(style).toBeDefined();
		expect(style?.id).toBe(DEFAULT_STYLE_ID);
	});

	it("getStylePrompt() returns the prompt for a valid style ID", () => {
		const prompt = getStylePrompt("3d_xuanhuan");
		const style = getStyleById("3d_xuanhuan");
		expect(prompt).toBe(style?.prompt);
	});

	it("getStylePrompt() returns first style prompt for unknown ID", () => {
		const prompt = getStylePrompt("unknown_id");
		expect(prompt).toBe(VISUAL_STYLE_PRESETS[0].prompt);
	});

	it("getStyleNegativePrompt() returns the negative prompt for a valid ID", () => {
		const negPrompt = getStyleNegativePrompt("3d_xuanhuan");
		const style = getStyleById("3d_xuanhuan");
		expect(negPrompt).toBe(style?.negativePrompt);
	});

	it("getStyleNegativePrompt() returns first style negative prompt for unknown ID", () => {
		const negPrompt = getStyleNegativePrompt("unknown_id");
		expect(negPrompt).toBe(VISUAL_STYLE_PRESETS[0].negativePrompt);
	});

	it("getStyleName() returns style name for valid ID", () => {
		const name = getStyleName("3d_american");
		expect(name).toBe("3D American");
	});

	it("getStyleName() returns the raw ID for unknown style", () => {
		const name = getStyleName("some_unknown");
		expect(name).toBe("some_unknown");
	});

	it("getStylesByCategory() returns only styles of that category", () => {
		const styles3d = getStylesByCategory("3d");
		expect(styles3d.length).toBeGreaterThan(0);
		for (const style of styles3d) {
			expect(style.category).toBe("3d");
		}
	});

	it('getStylesByCategory("animation") returns 3d + 2d + stop_motion', () => {
		const animationStyles = getStylesByCategory("animation");
		const categories = new Set(animationStyles.map((s) => s.category));
		// Should only contain 3d, 2d, and stop_motion
		for (const cat of categories) {
			expect(["3d", "2d", "stop_motion"]).toContain(cat);
		}
		expect(animationStyles.length).toBeGreaterThan(0);
	});

	it('getStylesByCategory("realistic") returns only real styles', () => {
		const realStyles = getStylesByCategory("realistic");
		for (const style of realStyles) {
			expect(style.category).toBe("real");
		}
		expect(realStyles.length).toBeGreaterThan(0);
	});

	it("getStyleDescription() returns description string for valid ID", () => {
		const desc = getStyleDescription("3d_xuanhuan");
		expect(desc).toBe("Chinese fantasy xianxia, UE5 render, stunning VFX");
	});

	it("getStyleDescription() returns the ID as fallback for unknown style", () => {
		const desc = getStyleDescription("completely_unknown");
		expect(desc).toBe("completely_unknown");
	});

	it("getMediaType() returns correct media type for a style", () => {
		expect(getMediaType("3d_xuanhuan")).toBe("cinematic");
		expect(getMediaType("3d_american")).toBe("animation");
		expect(getMediaType("stop_motion")).toBe("stop-motion");
		expect(getMediaType("2d_pixel")).toBe("graphic");
	});

	it('getMediaType() returns "cinematic" as default for unknown ID', () => {
		expect(getMediaType("unknown_style")).toBe("cinematic");
	});

	it("STYLE_CATEGORIES has 4 categories", () => {
		expect(STYLE_CATEGORIES).toHaveLength(4);
	});

	it("STYLE_CATEGORIES contains the expected category IDs", () => {
		const ids = STYLE_CATEGORIES.map((c) => c.id);
		expect(ids).toContain("3d");
		expect(ids).toContain("2d");
		expect(ids).toContain("real");
		expect(ids).toContain("stop_motion");
	});

	it("each STYLE_CATEGORIES entry has id, name, and non-empty styles", () => {
		for (const cat of STYLE_CATEGORIES) {
			expect(cat.id).toBeTruthy();
			expect(cat.name).toBeTruthy();
			expect(cat.styles.length).toBeGreaterThan(0);
		}
	});

	it("STYLE_CATEGORIES styles match their category", () => {
		for (const cat of STYLE_CATEGORIES) {
			for (const style of cat.styles) {
				expect(style.category).toBe(cat.id);
			}
		}
	});
});
