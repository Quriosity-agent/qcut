/**
 * Effect template utility functions
 * @module lib/effects-templates/utils
 */

import type {
	EffectParameters,
	EffectInstance,
	EffectType,
} from "@/types/effects";
import { generateUUID } from "@/lib/utils";
import type { EffectTemplate } from "./types";
import { EFFECT_TEMPLATES } from "./data";

// Helper: derive EffectType from provided parameters
const PARAM_TO_TYPE: ReadonlyArray<[keyof EffectParameters, EffectType]> = [
	["brightness", "brightness"],
	["contrast", "contrast"],
	["saturation", "saturation"],
	["hue", "hue"],
	["gamma", "gamma"],
	["sepia", "sepia"],
	["grayscale", "grayscale"],
	["invert", "invert"],
	["vintage", "vintage"],
	["dramatic", "dramatic"],
	["warm", "warm"],
	["cool", "cool"],
	["cinematic", "cinematic"],
	["vignette", "vignette"],
	["grain", "grain"],
	["sharpen", "sharpen"],
	["emboss", "emboss"],
	["edge", "edge"],
	["pixelate", "pixelate"],
	["wave", "wave"],
	["waveFrequency", "wave"],
	["waveAmplitude", "wave"],
	["twist", "twist"],
	["twistAngle", "twist"],
	["bulge", "bulge"],
	["bulgeRadius", "bulge"],
	["fisheye", "fisheye"],
	["fisheyeStrength", "fisheye"],
	["oilPainting", "oil-painting"],
	["brushSize", "oil-painting"],
	["watercolor", "watercolor"],
	["wetness", "watercolor"],
	["pencilSketch", "pencil-sketch"],
	["strokeWidth", "pencil-sketch"],
	["halftone", "halftone"],
	["dotSize", "halftone"],
	["fadeIn", "fade-in"],
	["fadeOut", "fade-out"],
	["dissolve", "dissolve"],
	["dissolveProgress", "dissolve"],
	["wipe", "wipe"],
	["wipeDirection", "wipe"],
	["wipeProgress", "wipe"],
	["overlay", "overlay"],
	["overlayOpacity", "overlay"],
	["multiply", "multiply"],
	["screen", "screen"],
	["colorDodge", "color-dodge"],
	["blendMode", "overlay"],
];

/**
 * Apply template to create effect instances
 */
export function applyTemplate(template: EffectTemplate): EffectInstance[] {
	return template.effects.map((effect) => ({
		id: generateUUID(),
		name: effect.name,
		effectType: inferEffectTypeFromParams(effect.parameters),
		parameters: effect.parameters,
		duration: 0,
		enabled: true,
	}));
}

/**
 * Save custom template
 */
export function saveCustomTemplate(
	name: string,
	description: string,
	effects: EffectInstance[]
): EffectTemplate {
	const template: EffectTemplate = {
		id: generateUUID(),
		name,
		description,
		category: "custom",
		effects: effects.map((effect, index) => ({
			name: effect.name,
			effectType: effect.effectType,
			parameters: effect.parameters,
			order: index + 1,
		})),
		metadata: {
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	};

	// Save to localStorage
	const savedTemplates = loadCustomTemplates();
	savedTemplates.push(template);
	try {
		localStorage.setItem(
			"effect-templates-custom",
			JSON.stringify(savedTemplates)
		);
	} catch {
		// Silently fail if localStorage is unavailable (quota, private mode, SSR)
	}

	return template;
}

function normalizeTemplate(t: any): EffectTemplate {
	const meta = t?.metadata ?? {};
	const toDate = (v: unknown) =>
		v instanceof Date ? v : typeof v === "string" ? new Date(v) : undefined;
	return {
		...t,
		metadata: {
			...meta,
			createdAt: toDate(meta.createdAt),
			updatedAt: toDate(meta.updatedAt),
		},
	} as EffectTemplate;
}

/**
 * Load custom templates from localStorage
 */
export function loadCustomTemplates(): EffectTemplate[] {
	try {
		const saved = localStorage.getItem("effect-templates-custom");
		if (saved) {
			const parsed = JSON.parse(saved) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.map(normalizeTemplate) as EffectTemplate[];
			}
		}
	} catch {
		// Silently fail if localStorage is unavailable or data is corrupted
	}
	return [];
}

/**
 * Delete custom template
 */
export function deleteCustomTemplate(templateId: string): void {
	const templates = loadCustomTemplates();
	const filtered = templates.filter((t) => t.id !== templateId);
	try {
		localStorage.setItem("effect-templates-custom", JSON.stringify(filtered));
	} catch {
		// Silently fail if localStorage is unavailable
	}
}

/**
 * Export template as JSON
 */
export function exportTemplate(template: EffectTemplate): string {
	return JSON.stringify(template, null, 2);
}

/**
 * Infer effect category from parameters
 */
function inferEffectCategory(parameters: EffectParameters): string {
	// Look for the first defined parameter to guess effect type
	if (
		parameters.brightness !== undefined ||
		parameters.contrast !== undefined ||
		parameters.saturation !== undefined ||
		parameters.hue !== undefined
	) {
		return "color";
	}
	if (parameters.blur !== undefined) return "blur";
	if (
		parameters.sepia !== undefined ||
		parameters.grayscale !== undefined ||
		parameters.invert !== undefined
	) {
		return "color";
	}
	if (
		parameters.vintage !== undefined ||
		parameters.dramatic !== undefined ||
		parameters.warm !== undefined ||
		parameters.cool !== undefined ||
		parameters.cinematic !== undefined
	) {
		return "style";
	}
	if (
		parameters.vignette !== undefined ||
		parameters.grain !== undefined ||
		parameters.sharpen !== undefined ||
		parameters.emboss !== undefined
	) {
		return "enhancement";
	}
	if (
		parameters.wave !== undefined ||
		parameters.twist !== undefined ||
		parameters.bulge !== undefined ||
		parameters.fisheye !== undefined
	) {
		return "distortion";
	}
	if (
		parameters.oilPainting !== undefined ||
		parameters.watercolor !== undefined ||
		parameters.pencilSketch !== undefined ||
		parameters.halftone !== undefined
	) {
		return "artistic";
	}
	if (
		parameters.fadeIn !== undefined ||
		parameters.fadeOut !== undefined ||
		parameters.dissolve !== undefined ||
		parameters.wipe !== undefined
	) {
		return "transition";
	}
	if (
		parameters.overlay !== undefined ||
		parameters.multiply !== undefined ||
		parameters.screen !== undefined ||
		parameters.colorDodge !== undefined
	) {
		return "composite";
	}
	return "unknown";
}

/**
 * Infer specific effect type from parameters
 */
function inferEffectTypeFromParams(parameters: EffectParameters): EffectType {
	// Look for the first defined parameter to determine specific effect type
	if (parameters.brightness !== undefined) return "brightness";
	if (parameters.contrast !== undefined) return "contrast";
	if (parameters.saturation !== undefined) return "saturation";
	if (parameters.hue !== undefined) return "hue";
	if (parameters.blur !== undefined) return "blur";
	if (parameters.sepia !== undefined) return "sepia";
	if (parameters.grayscale !== undefined) return "grayscale";
	if (parameters.invert !== undefined) return "invert";
	if (parameters.vintage !== undefined) return "vintage";
	if (parameters.dramatic !== undefined) return "dramatic";
	if (parameters.warm !== undefined) return "warm";
	if (parameters.cool !== undefined) return "cool";
	if (parameters.cinematic !== undefined) return "cinematic";
	if (parameters.vignette !== undefined) return "vignette";
	if (parameters.grain !== undefined) return "grain";
	if (parameters.sharpen !== undefined) return "sharpen";
	if (parameters.emboss !== undefined) return "emboss";
	if (parameters.wave !== undefined) return "wave";
	if (parameters.twist !== undefined) return "twist";
	if (parameters.bulge !== undefined) return "bulge";
	if (parameters.fisheye !== undefined) return "fisheye";
	if (parameters.oilPainting !== undefined) return "oil-painting";
	if (parameters.watercolor !== undefined) return "watercolor";
	if (parameters.pencilSketch !== undefined) return "pencil-sketch";
	if (parameters.halftone !== undefined) return "halftone";
	if (parameters.fadeIn !== undefined) return "fade-in";
	if (parameters.fadeOut !== undefined) return "fade-out";
	if (parameters.dissolve !== undefined) return "dissolve";
	if (parameters.wipe !== undefined) return "wipe";
	if (parameters.overlay !== undefined) return "overlay";
	if (parameters.multiply !== undefined) return "multiply";
	if (parameters.screen !== undefined) return "screen";
	if (parameters.colorDodge !== undefined) return "color-dodge";
	return "brightness";
}

/**
 * Import template from JSON
 */
export function importTemplate(json: string): EffectTemplate | null {
	try {
		const candidate = JSON.parse(json) as any;
		if (
			candidate &&
			typeof candidate.id === "string" &&
			typeof candidate.name === "string" &&
			Array.isArray(candidate.effects) &&
			candidate.effects.every(
				(e: any) =>
					e &&
					typeof e.name === "string" &&
					(typeof e.order === "number" || e.order === undefined) &&
					e.parameters &&
					typeof e.parameters === "object"
			)
		) {
			// Ensure required fields and proper types
			return {
				id: candidate.id,
				name: candidate.name,
				description: candidate.description || "",
				category: candidate.category || "custom",
				effects: candidate.effects.map((e: any, i: number) => ({
					name: e.name,
					// Support both old 'type' and new 'effectType' fields for backward compatibility
					effectType:
						e.effectType || e.type || inferEffectTypeFromParams(e.parameters),
					parameters: e.parameters,
					order: typeof e.order === "number" ? e.order : i + 1,
					blendMode: e.blendMode,
				})),
				thumbnail: candidate.thumbnail,
				metadata: candidate.metadata,
			} as EffectTemplate;
		}
	} catch {
		// Silently ignore malformed import
	}
	return null;
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: string): EffectTemplate[] {
	const allTemplates = [...EFFECT_TEMPLATES, ...loadCustomTemplates()];

	if (category === "all") {
		return allTemplates;
	}

	return allTemplates.filter((t) => t.category === category);
}

/**
 * Search templates
 */
export function searchTemplates(query: string): EffectTemplate[] {
	const allTemplates = [...EFFECT_TEMPLATES, ...loadCustomTemplates()];
	const lowerQuery = query.toLowerCase();

	return allTemplates.filter(
		(t) =>
			t.name.toLowerCase().includes(lowerQuery) ||
			t.description.toLowerCase().includes(lowerQuery) ||
			t.metadata?.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
	);
}
