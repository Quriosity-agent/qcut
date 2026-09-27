import { RotateCcw } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function PortraitNumberControl({
	label,
	value,
	min,
	max,
	step,
	disabled,
	locale,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	disabled: boolean;
	locale: string;
	onChange: (value: number) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const [draft, setDraft] = useState(String(value));
	const interacting = useRef(false);
	const cancelled = useRef(false);
	useEffect(() => setDraft(String(value)), [value]);
	const start = () => {
		if (interacting.current) return;
		interacting.current = true;
		onInteractionStart();
	};
	const end = () => {
		if (!interacting.current) return;
		interacting.current = false;
		onInteractionEnd();
	};
	const commit = () => {
		const parsed = Number(draft);
		if (cancelled.current || !draft.trim() || !Number.isFinite(parsed)) {
			cancelled.current = false;
			setDraft(String(value));
			end();
			return;
		}
		const rounded = min + Math.round((parsed - min) / step) * step;
		const next = Number(Math.min(max, Math.max(min, rounded)).toFixed(6));
		setDraft(String(next));
		if (next !== value) onChange(next);
		end();
	};
	const clampedValue = Math.min(max, Math.max(min, value));
	const zero = Math.min(max, Math.max(min, 0));
	const percent = ((clampedValue - min) / (max - min)) * 100;
	const zeroPercent = ((zero - min) / (max - min)) * 100;
	const resetLabel = locale === "zh" ? `重置${label}` : `Reset ${label}`;
	return (
		<div className="grid min-h-8 min-w-0 grid-cols-[minmax(0,5rem)_minmax(2rem,1fr)_3rem_1.5rem] items-center gap-2">
			<span className="break-words text-[11px] leading-4" title={label}>
				{label}
			</span>
			<SliderPrimitive.Root
				className="relative flex h-8 min-w-0 touch-none select-none items-center"
				value={[clampedValue]}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				onValueChange={([next]) => onChange(next)}
				onPointerDown={start}
				onPointerUp={end}
				onPointerCancel={end}
				onLostPointerCapture={end}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (
						[
							"ArrowLeft",
							"ArrowRight",
							"ArrowUp",
							"ArrowDown",
							"Home",
							"End",
							"PageUp",
							"PageDown",
						].includes(event.key)
					)
						start();
				}}
				onKeyUp={end}
				onBlur={end}
			>
				<SliderPrimitive.Track className="relative h-0.5 w-full rounded-full bg-muted-foreground/30">
					<span
						className="absolute h-full bg-primary"
						style={{
							left: `${Math.min(percent, zeroPercent)}%`,
							width: `${Math.abs(percent - zeroPercent)}%`,
						}}
					/>
					{min < 0 && max > 0 ? (
						<span
							aria-hidden="true"
							className="absolute -top-0.5 h-1.5 w-px bg-muted-foreground"
							style={{ left: `${zeroPercent}%` }}
						/>
					) : null}
				</SliderPrimitive.Track>
				<SliderPrimitive.Thumb
					aria-label={label}
					className="block size-2.5 rounded-full border border-primary/50 bg-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</SliderPrimitive.Root>
			<input
				type="text"
				inputMode="decimal"
				aria-label={locale === "zh" ? `${label}数值` : `${label} value`}
				className="h-6 w-full min-w-0 rounded border border-border bg-background px-1 text-center text-[11px] tabular-nums focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
				value={draft}
				disabled={disabled}
				onFocus={start}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Escape") {
						cancelled.current = true;
						event.currentTarget.blur();
					}
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>
			<Button
				type="button"
				variant="text"
				size="icon"
				className="size-6"
				aria-label={resetLabel}
				title={resetLabel}
				disabled={disabled || value === zero}
				onClick={() => {
					start();
					onChange(zero);
					end();
				}}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<RotateCcw className="size-3" />
			</Button>
		</div>
	);
}
