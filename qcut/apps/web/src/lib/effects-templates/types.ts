/**
 * Effect template type definitions
 * @module lib/effects-templates/types
 */

export interface EffectTemplate {
	id: string;
	name: string;
	description: string;
	category: "professional" | "creative" | "vintage" | "modern" | "custom";
	thumbnail?: string;
	effects: TemplateEffect[];
	metadata?: {
		author?: string;
		version?: string;
		tags?: string[];
		createdAt?: Date;
		updatedAt?: Date;
	};
}

export interface TemplateEffect {
	name: string;
	effectType: string;
	parameters: import("@/types/effects").EffectParameters;
	order: number;
	blendMode?: string;
}
