/**
 * ImportProgress — 6-step pipeline progress tracker for script import.
 * Shows current step, completed steps, and pending steps.
 */

import { useMoyinStore } from "@/stores/moyin/moyin-store";
import type {
	PipelineStep,
	PipelineStepStatus,
} from "@/stores/moyin/moyin-store";
import { useMediaPanelStore } from "../../store";
import { cn } from "@/lib/utils";
import {
	CheckCircle2Icon,
	CircleIcon,
	Loader2,
	SquareTerminalIcon,
	XCircleIcon,
} from "lucide-react";

const PIPELINE_STEPS: { key: PipelineStep; label: string }[] = [
	{ key: "import", label: "Import Script" },
	{ key: "title_calibration", label: "Title Calibration" },
	{ key: "synopsis", label: "Synopsis Generation" },
	{ key: "shot_calibration", label: "Shot Calibration" },
	{ key: "character_calibration", label: "Character Calibration" },
	{ key: "scene_calibration", label: "Scene Calibration" },
];

function StepIcon({ status }: { status: PipelineStepStatus }) {
	switch (status) {
		case "done":
			return <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500" />;
		case "active":
			return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
		case "error":
			return <XCircleIcon className="h-3.5 w-3.5 text-destructive" />;
		default:
			return <CircleIcon className="h-3.5 w-3.5 text-muted-foreground/40" />;
	}
}

export function ImportProgress() {
	const pipelineStep = useMoyinStore((s) => s.pipelineStep);
	const pipelineProgress = useMoyinStore((s) => s.pipelineProgress);
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const parseProvider = useMoyinStore((s) => s.parseProvider);

	if (!pipelineStep) return null;

	return (
		<div className="rounded-md border bg-muted/20 p-2.5 space-y-1.5">
			<div className="flex items-center justify-between">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					Import Pipeline
				</p>
				{parseStatus === "parsing" && (
					<button
						type="button"
						className="flex items-center gap-1 text-[10px] text-primary hover:underline"
						onClick={() => useMediaPanelStore.getState().setActiveTab("pty")}
					>
						<SquareTerminalIcon className="h-3 w-3" />
						View in Terminal
					</button>
				)}
			</div>
			{parseProvider && parseStatus === "parsing" && (
				<p className="text-[10px] text-muted-foreground">
					Parsing with{" "}
					<span className="font-medium text-foreground">{parseProvider}</span>
				</p>
			)}
			<div className="space-y-1" aria-live="polite" aria-atomic="true">
				{PIPELINE_STEPS.map((step) => {
					const status = pipelineProgress[step.key];
					const statusLabel =
						status === "done"
							? "completed"
							: status === "active"
								? "in progress"
								: status === "error"
									? "failed"
									: "pending";
					return (
						<div
							key={step.key}
							className={cn(
								"flex items-center gap-2 py-0.5 text-xs",
								status === "active"
									? "text-primary font-medium"
									: status === "done"
										? "text-green-600 dark:text-green-400"
										: status === "error"
											? "text-destructive"
											: "text-muted-foreground"
							)}
							aria-label={`${step.label}: ${statusLabel}`}
						>
							<StepIcon status={status} />
							<span>{step.label}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
