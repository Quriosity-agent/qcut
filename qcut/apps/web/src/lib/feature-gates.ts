/** Plan tiers in ascending order of access */
export type Plan = "free" | "pro" | "team";

/** Features that can be gated by plan */
export type FeatureName =
	| "ai-generation"
	| "export-4k"
	| "no-watermark"
	| "all-templates"
	| "team-collab"
	| "api-access";

/** Which plans have access to each feature. Free AI generation has credit limits. */
export const FEATURE_GATES: Record<FeatureName, Plan[]> = {
	"ai-generation": ["free", "pro", "team"],
	"export-4k": ["pro", "team"],
	"no-watermark": ["pro", "team"],
	"all-templates": ["pro", "team"],
	"team-collab": ["team"],
	"api-access": ["team"],
};

/** Default monthly credits per plan */
export const PLAN_CREDITS: Record<Plan, number> = {
	free: 50,
	pro: 500,
	team: 2000,
};

/** Check if a plan has access to a feature */
export function canPlanUseFeature(plan: Plan, feature: FeatureName): boolean {
	return FEATURE_GATES[feature].includes(plan);
}

/** Get human-readable label for upgrade prompts */
export function getUpgradeTarget(feature: FeatureName): Plan {
	const plans = FEATURE_GATES[feature];
	if (plans.includes("pro")) return "pro";
	return "team";
}
