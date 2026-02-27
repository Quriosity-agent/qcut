import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLicenseStore } from "@/stores/license-store";
import { getUpgradeTarget } from "@/lib/feature-gates";
import type { FeatureName } from "@/lib/feature-gates";
import { PLAN_CREDITS } from "@/lib/feature-gates";

interface UpgradePromptProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	feature: FeatureName;
	featureLabel: string;
}

const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
	"export-4k": "Export in 4K resolution",
	"no-watermark": "Export without watermark",
	"all-templates": "Access all templates",
	"team-collab": "Team collaboration features",
	"api-access": "API access for automation",
	"ai-generation": "AI content generation",
};

export function UpgradePrompt({
	open,
	onOpenChange,
	feature,
	featureLabel,
}: UpgradePromptProps) {
	const openPricingPage = useLicenseStore((s) => s.openPricingPage);
	const targetPlan = getUpgradeTarget(feature);
	const credits = PLAN_CREDITS[targetPlan];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" aria-describedby="upgrade-desc">
				<DialogHeader>
					<DialogTitle>
						This is a {targetPlan === "team" ? "Team" : "Pro"} feature
					</DialogTitle>
					<DialogDescription id="upgrade-desc">
						{featureLabel || FEATURE_DESCRIPTIONS[feature]} requires a{" "}
						{targetPlan === "team" ? "Team" : "Pro"} plan. Upgrade to unlock
						this feature and get {credits} credits/month.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Maybe Later
					</Button>
					<Button
						onClick={() => {
							openPricingPage();
							onOpenChange(false);
						}}
					>
						View Plans
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
