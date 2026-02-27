export interface LicenseInfo {
  plan: "free" | "pro" | "team";
  status: "active" | "past_due" | "cancelled" | "expired";
  currentPeriodEnd?: string;
  aiGenerationsUsed: number;
  aiGenerationsLimit: number;
}

export interface ElectronLicenseOps {
  check: () => Promise<LicenseInfo>;
  activate: (token: string) => Promise<boolean>;
  trackUsage: (type: string) => Promise<void>;
  deactivate: () => Promise<boolean>;
}
