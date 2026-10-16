import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
	AUTOMATION_RANGES,
	type AutomationParam,
	automationValueAt,
	hasAutomation,
	normalizeAutomationPoints,
} from "@/lib/audio/audio-mix-automation";
import type { AutomationPatch } from "@/lib/audio/audio-mix-patch";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import type {
	AudioAutomationPoint,
	AudioMixAutomation,
} from "@/types/timeline";

/**
 * A strip's level and pan curves as lists of points on the timeline. Each
 * change sends the whole curve, so the editor API and this editor set
 * curves the same way.
 */

const CURVES: Array<{
	param: AutomationParam;
	labelKey: TranslationKey;
	step: number;
	unit: string;
}> = [
	{ param: "gainDb", labelKey: "mixer.levelCurve", step: 0.5, unit: "dB" },
	{ param: "pan", labelKey: "mixer.panCurve", step: 0.05, unit: "" },
];

function readNumber(event: React.FocusEvent<HTMLInputElement>): number | null {
	const value = Number(event.target.value);
	return Number.isFinite(value) ? value : null;
}

function CurveEditor({
	param,
	labelKey,
	step,
	unit,
	points,
	fixedValue,
	onChange,
	testId,
}: (typeof CURVES)[number] & {
	points: AudioAutomationPoint[];
	fixedValue: number;
	onChange: (points: AudioAutomationPoint[] | null) => void;
	testId: string;
}) {
	const { t } = useTranslation();
	const [min, max] = AUTOMATION_RANGES[param];
	const set = (next: AudioAutomationPoint[]) =>
		onChange(
			next.length > 0
				? normalizeAutomationPoints({ points: next, param })
				: null
		);
	const replace = (index: number, point: AudioAutomationPoint) =>
		set(points.map((existing, at) => (at === index ? point : existing)));
	const addAtPlayhead = () => {
		const time = Number(usePlaybackStore.getState().currentTime.toFixed(3));
		const value =
			points.length > 0 ? automationValueAt({ points, time }) : fixedValue;
		set([...points, { time, value: Number(value.toFixed(2)) }]);
	};

	return (
		<section className="space-y-1.5" data-testid={testId}>
			<div className="flex items-center gap-1">
				<span className="min-w-0 flex-1 text-xs font-medium">
					{t(labelKey)}
					{points.length > 0 ? (
						<span className="ml-1 text-[10px] text-muted-foreground">
							({points.length})
						</span>
					) : null}
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-6 gap-1 px-2 text-[11px]"
					onClick={addAtPlayhead}
					data-testid={`${testId}-add`}
				>
					<Plus className="size-3" />
					{t("mixer.addPointAtPlayhead")}
				</Button>
				{points.length > 0 ? (
					<Button
						type="button"
						variant="text"
						size="icon"
						className="size-6"
						aria-label={t("mixer.clearCurve")}
						title={t("mixer.clearCurve")}
						onClick={() => onChange(null)}
						data-testid={`${testId}-clear`}
					>
						<X className="size-3" />
					</Button>
				) : null}
			</div>
			{points.length === 0 ? (
				<p className="text-[11px] text-muted-foreground">
					{t("mixer.noPoints")}
				</p>
			) : (
				<div className="space-y-1">
					<div className="grid grid-cols-[1fr_1fr_1.5rem] gap-1 text-[10px] text-muted-foreground">
						<span>{t("mixer.pointTime")}</span>
						<span>
							{t("mixer.pointValue")}
							{unit ? ` (${unit})` : ""}
						</span>
						<span />
					</div>
					{points.map((point, index) => (
						<div
							key={`${point.time}-${index}`}
							className="grid grid-cols-[1fr_1fr_1.5rem] items-center gap-1"
							data-testid={`${testId}-point-${index}`}
						>
							<Input
								type="number"
								aria-label={t("mixer.pointTime")}
								className="h-6 rounded-sm px-1 text-[11px] tabular-nums"
								defaultValue={point.time}
								min={0}
								step={0.1}
								onBlur={(event) => {
									const time = readNumber(event);
									if (time !== null && time !== point.time) {
										replace(index, { ...point, time });
									}
								}}
							/>
							<Input
								type="number"
								aria-label={t("mixer.pointValue")}
								className="h-6 rounded-sm px-1 text-[11px] tabular-nums"
								defaultValue={point.value}
								min={min}
								max={max}
								step={step}
								onBlur={(event) => {
									const value = readNumber(event);
									if (value !== null && value !== point.value) {
										replace(index, { ...point, value });
									}
								}}
							/>
							<Button
								type="button"
								variant="text"
								size="icon"
								className="size-6"
								aria-label={t("mixer.removePoint")}
								title={t("mixer.removePoint")}
								onClick={() => set(points.filter((_, at) => at !== index))}
							>
								<Trash2 className="size-3" />
							</Button>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

export function MixAutomationEditor({
	automation,
	fixed,
	onChange,
	testId,
}: {
	automation?: AudioMixAutomation;
	/** The strip's fixed level and pan: a new curve starts from them. */
	fixed: { gainDb: number; pan: number };
	onChange: (patch: AutomationPatch) => void;
	testId: string;
}) {
	return (
		<div className="w-80 space-y-3 px-1" data-testid={testId}>
			{CURVES.map((curve) => (
				<CurveEditor
					key={curve.param}
					{...curve}
					points={automation?.[curve.param] ?? []}
					fixedValue={fixed[curve.param]}
					onChange={(points) => onChange({ [curve.param]: points })}
					testId={`${testId}-${curve.param}`}
				/>
			))}
		</div>
	);
}

/** The "A" button that opens a strip's automation; lit while it has curves. */
export function MixAutomationPopover({
	automation,
	fixed,
	name,
	testId,
	onChange,
}: {
	automation?: AudioMixAutomation;
	fixed: { gainDb: number; pan: number };
	name: string;
	testId: string;
	onChange: (patch: AutomationPatch) => void;
}) {
	const { t } = useTranslation();
	const active = hasAutomation(automation);
	const label = t("mixer.automationOf", { name });
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={label}
					aria-pressed={active}
					title={label}
					data-testid={testId}
					className={cn(
						"grid size-5 shrink-0 place-items-center rounded-sm border border-border/70 text-[10px] font-semibold leading-none text-muted-foreground hover:text-foreground",
						active && "border-primary/60 bg-primary/15 text-primary"
					)}
				>
					A
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="max-h-[70vh] overflow-y-auto">
				<MixAutomationEditor
					automation={automation}
					fixed={fixed}
					onChange={onChange}
					testId={`${testId}-editor`}
				/>
			</PopoverContent>
		</Popover>
	);
}
