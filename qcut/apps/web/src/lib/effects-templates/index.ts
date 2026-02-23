/**
 * Effect templates barrel export
 *
 * Re-exports all types, data, and utilities.
 * Maintains backward compatibility with the original effects-templates.ts.
 *
 * @module lib/effects-templates
 */

export type { EffectTemplate, TemplateEffect } from "./types";
export { EFFECT_TEMPLATES } from "./data";
export {
	applyTemplate,
	saveCustomTemplate,
	loadCustomTemplates,
	deleteCustomTemplate,
	exportTemplate,
	importTemplate,
	getTemplatesByCategory,
	searchTemplates,
} from "./utils";
