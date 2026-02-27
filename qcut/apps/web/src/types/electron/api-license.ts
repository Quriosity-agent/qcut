export interface CreditBalance {
	planCredits: number;
	topUpCredits: number;
	totalCredits: number;
	planCreditsResetAt: string;
}

export interface LicenseInfo {
	plan: "free" | "pro" | "team";
	status: "active" | "past_due" | "cancelled" | "expired";
	currentPeriodEnd?: string;
	credits: CreditBalance;
}

export interface ElectronLicenseOps {
	license?: {
		check: () => Promise<LicenseInfo>;
		activate: (token: string) => Promise<boolean>;
		deductCredits: (
			amount: number,
			modelKey: string,
			description: string
		) => Promise<boolean>;
		deactivate: () => Promise<boolean>;
	};
}
