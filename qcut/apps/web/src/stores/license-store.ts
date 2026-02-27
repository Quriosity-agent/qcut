import { create } from "zustand";
import { FEATURE_GATES } from "@/lib/feature-gates";
import type { Plan } from "@/lib/feature-gates";

interface CreditBalance {
	planCredits: number;
	topUpCredits: number;
	totalCredits: number;
	planCreditsResetAt: string;
}

interface LicenseInfo {
	plan: Plan;
	status: "active" | "past_due" | "cancelled" | "expired";
	currentPeriodEnd?: string;
	credits: CreditBalance;
}

interface LicenseState {
	license: LicenseInfo | null;
	isLoading: boolean;
	checkLicense: () => Promise<void>;
	trackUsage: (type: "ai_generation" | "export" | "render") => Promise<void>;
	canUseFeature: (feature: string) => boolean;
	clearLicense: () => void;
	openBuyCreditsPage: () => void;
	openPricingPage: () => void;
}

const FREE_FALLBACK: LicenseInfo = {
	plan: "free",
	status: "active",
	credits: {
		planCredits: 50,
		topUpCredits: 0,
		totalCredits: 50,
		planCreditsResetAt: "",
	},
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
				set({ license: FREE_FALLBACK });
			}
		} catch {
			set({ license: FREE_FALLBACK });
		} finally {
			set({ isLoading: false });
		}
	},

	canUseFeature: (feature: string) => {
		const { license } = get();
		if (!license) return false;
		const allowed = FEATURE_GATES[feature as keyof typeof FEATURE_GATES];
		if (!allowed) return true;
		return allowed.includes(license.plan);
	},

	trackUsage: async (type) => {
		if ((window as any).electronAPI) {
			await (window as any).electronAPI.license.trackUsage(type);
		}
	},

	clearLicense: () => set({ license: null }),

	openBuyCreditsPage: () => {
		window.open(
			"https://donghaozhang.github.io/nexusai-website/account/credits.html",
			"_blank"
		);
	},

	openPricingPage: () => {
		window.open(
			"https://donghaozhang.github.io/nexusai-website/account/pricing.html",
			"_blank"
		);
	},
}));
