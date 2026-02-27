export const CLAUDE_CAPABILITY_CATEGORIES = {
	TIMELINE: "timeline",
	MEDIA: "media",
	PROJECT: "project",
	EXPORT: "export",
	ANALYSIS: "analysis",
	STATE: "state",
	EVENTS: "events",
	TRANSACTIONS: "transactions",
} as const;

export type ClaudeCapabilityCategory =
	(typeof CLAUDE_CAPABILITY_CATEGORIES)[keyof typeof CLAUDE_CAPABILITY_CATEGORIES];

export interface Capability {
	name: string;
	version: string;
	description: string;
	since: string;
	category: ClaudeCapabilityCategory;
	deprecated?: boolean;
	alternatives?: string[];
}

export interface ApiVersionInfo {
	apiVersion: string;
	protocolVersion: string;
	appVersion?: string;
	electronVersion?: string;
}

export interface CapabilityManifest extends ApiVersionInfo {
	capabilities: Capability[];
}

export interface CommandRegistryEntry {
	name: string;
	description: string;
	paramsSchema: {
		type: "object";
		properties: Record<
			string,
			{
				type: string | string[];
				description: string;
			}
		>;
		required?: string[];
		additionalProperties?: boolean;
	};
	requiredCapability: string;
	category: ClaudeCapabilityCategory;
}
