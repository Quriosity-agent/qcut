import { create } from "zustand";

type Plan = "free" | "pro" | "team";

interface LicenseInfo {
	plan: Plan;
	status: "active" | "past_due" | "cancelled" | "expired";
	currentPeriodEnd?: string;
	aiGenerationsUsed: number;
	aiGenerationsLimit: number;
}

interface LicenseState {
	license: LicenseInfo | null;
	isLoading: boolean;
	checkLicense: () => Promise<void>;
	trackUsage: (type: "ai_generation" | "export" | "render") => Promise<void>;
	canUseFeature: (feature: string) => boolean;
	clearLicense: () => void;
}

const FEATURE_GATES: Record<string, Plan[]> = {
	"ai-generation": ["free", "pro", "team"],
	"export-4k": ["pro", "team"],
	"no-watermark": ["pro", "team"],
	"all-templates": ["pro", "team"],
	"team-collab": ["team"],
	"api-access": ["team"],
};

const USAGE_LIMITS: Record<Plan, Record<string, number>> = {
	free: { ai_generation: 5, render: 10 },
	pro: { ai_generation: Infinity, render: Infinity },
	team: { ai_generation: Infinity, render: Infinity },
};

export const useLicenseStore = create<LicenseState>((set, get) => ({
	license: null,
	isLoading: false,

	checkLicense: async () => {
		set({ isLoading: true });
		try {
			if ((window as any).electronAPI) {
				const license = await (window as any).electronAPI.license.check();
				set({ license });
			} else {
				// Web fallback — call license server directly
				set({
					license: {
						plan: "free",
						status: "active",
						aiGenerationsUsed: 0,
						aiGenerationsLimit: 5,
					},
				});
			}
		} catch {
			set({
				license: {
					plan: "free",
					status: "active",
					aiGenerationsUsed: 0,
					aiGenerationsLimit: 5,
				},
			});
		} finally {
			set({ isLoading: false });
		}
	},

	canUseFeature: (feature: string) => {
		const { license } = get();
		if (!license) return false;
		const allowed = FEATURE_GATES[feature];
		if (!allowed) return true;
		return allowed.includes(license.plan);
	},

	trackUsage: async (type) => {
		if ((window as any).electronAPI) {
			await (window as any).electronAPI.license.trackUsage(type);
		}
	},

	clearLicense: () => set({ license: null }),
}));
