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
import { useExportStore } from "@/stores/export-store";

interface BuyCreditsPromptProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	requiredCredits: number;
	operationLabel: string;
}

export function BuyCreditsPrompt({
	open,
	onOpenChange,
	requiredCredits,
	operationLabel,
}: BuyCreditsPromptProps) {
	const license = useLicenseStore((s) => s.license);
	const openBuyCreditsPage = useLicenseStore((s) => s.openBuyCreditsPage);
	const setPanelView = useExportStore((s) => s.setPanelView);
	const remainingCredits = license?.credits.totalCredits ?? 0;

	const openApiKeySettings = () => {
		try {
			setPanelView("settings");
			onOpenChange(false);
		} catch {
			onOpenChange(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" aria-describedby="credits-desc">
				<DialogHeader>
					<DialogTitle>Not enough credits</DialogTitle>
					<DialogDescription id="credits-desc">
						{operationLabel} costs {requiredCredits} credits. You have{" "}
						{remainingCredits} credits remaining.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="outline" onClick={openApiKeySettings}>
						Add API Key
					</Button>
					<Button
						onClick={() => {
							openBuyCreditsPage();
							onOpenChange(false);
						}}
					>
						Buy Credits
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
