import { useLicenseStore } from "@/stores/license-store";

/** Compact credit balance display for editor toolbar/status bar */
export function CreditBalance() {
	const license = useLicenseStore((s) => s.license);
	const openBuyCreditsPage = useLicenseStore((s) => s.openBuyCreditsPage);

	if (!license) return null;

	const { totalCredits } = license.credits;

	return (
		<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
			<span>
				Credits:{" "}
				<span className="font-medium text-foreground">{totalCredits}</span>
			</span>
			<button
				type="button"
				onClick={openBuyCreditsPage}
				className="text-primary hover:underline"
			>
				+ Buy More
			</button>
		</div>
	);
}
