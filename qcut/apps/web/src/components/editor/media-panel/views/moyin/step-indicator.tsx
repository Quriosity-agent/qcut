/**
 * StepIndicator — horizontal step bar for the Moyin workflow.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import type { MoyinStep } from "@/stores/moyin-store";
import { cn } from "@/lib/utils";
import {
	FileTextIcon,
	UsersIcon,
	MapPinIcon,
	SparklesIcon,
} from "lucide-react";

const STEPS: { key: MoyinStep; label: string; icon: React.ElementType }[] = [
	{ key: "script", label: "Script", icon: FileTextIcon },
	{ key: "characters", label: "Characters", icon: UsersIcon },
	{ key: "scenes", label: "Scenes", icon: MapPinIcon },
	{ key: "generate", label: "Generate", icon: SparklesIcon },
];

export function StepIndicator() {
	const activeStep = useMoyinStore((s) => s.activeStep);
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const setActiveStep = useMoyinStore((s) => s.setActiveStep);

	const canNavigateTo = (step: MoyinStep): boolean => {
		if (step === "script") return true;
		// Can only access later steps after parsing is done
		return parseStatus === "ready";
	};

	return (
		<div className="flex items-center gap-1">
			{STEPS.map((step, i) => {
				const isActive = activeStep === step.key;
				const isClickable = canNavigateTo(step.key);
				const Icon = step.icon;

				return (
					<button
						key={step.key}
						type="button"
						disabled={!isClickable}
						onClick={() => isClickable && setActiveStep(step.key)}
						className={cn(
							"flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
							isActive
								? "bg-primary text-primary-foreground"
								: isClickable
									? "hover:bg-muted text-muted-foreground"
									: "text-muted-foreground/40 cursor-not-allowed"
						)}
					>
						<Icon className="h-3.5 w-3.5" />
						<span>{step.label}</span>
					</button>
				);
			})}
		</div>
	);
}
