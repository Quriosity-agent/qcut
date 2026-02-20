export interface Text2ImageModel {
	id: string;
	name: string;
	description: string;
	provider: string;
	endpoint: string;

	// Quality indicators (1-5 scale)
	qualityRating: number;
	speedRating: number;

	// Cost information
	estimatedCost: string;
	costPerImage: number; // in credits/cents

	// Technical specifications
	maxResolution: string;
	supportedAspectRatios: string[];

	// Model-specific parameters
	defaultParams: Record<string, string | number | boolean>;
	availableParams: Array<{
		name: string;
		type: "number" | "string" | "boolean" | "select";
		min?: number;
		max?: number;
		options?: string[];
		default: string | number | boolean | null;
		description: string;
	}>;

	// Use case recommendations
	bestFor: string[];
	strengths: string[];
	limitations: string[];
}
