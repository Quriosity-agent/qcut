import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type { AudioMeterReading } from "@/lib/audio/audio-metering";
import { cn } from "@/lib/utils";

/**
 * The mixer's small controls. A drag is one gesture: `onGestureStart` once,
 * `onChange` on every move with `inGesture` true, `onGestureEnd` at release.
 * Keyboard steps arrive as single changes with `inGesture` false.
 */

export interface MixGestureHandlers {
	onGestureStart?: () => void;
	onChange: (value: number, inGesture: boolean) => void;
	onGestureEnd?: (value: number) => void;
}

function useMixGesture({
	onGestureStart,
	onChange,
	onGestureEnd,
}: MixGestureHandlers) {
	const active = useRef(false);
	return {
		onPointerDown: () => {
			active.current = true;
			onGestureStart?.();
		},
		onValueChange: ([value]: number[]) => onChange(value, active.current),
		onValueCommit: ([value]: number[]) => {
			if (!active.current) return;
			active.current = false;
			onGestureEnd?.(value);
		},
	};
}

export const MIN_LEVEL_DB = -60;
export const MAX_LEVEL_DB = 12;

export function formatLevel(db: number): string {
	if (db <= MIN_LEVEL_DB) return "-∞";
	return `${db > 0 ? "+" : ""}${db.toFixed(1)}`;
}

function formatPan(pan: number): string {
	if (Math.abs(pan) < 0.005) return "C";
	const amount = Math.round(Math.abs(pan) * 100);
	return pan < 0 ? `L${amount}` : `R${amount}`;
}

/** Level in dB; double-click returns it to 0 dB. */
export function LevelFader({
	label,
	value,
	testId,
	...handlers
}: MixGestureHandlers & {
	label: string;
	value: number;
	testId: string;
}) {
	const gesture = useMixGesture(handlers);
	const [draft, setDraft] = useState<string | null>(null);
	const commitDraft = () => {
		if (draft === null) return;
		const next = Number(draft);
		setDraft(null);
		if (!Number.isFinite(next)) return;
		handlers.onChange(
			Math.min(MAX_LEVEL_DB, Math.max(MIN_LEVEL_DB, next)),
			false
		);
	};
	return (
		<div className="flex min-w-0 items-center gap-1.5" data-testid={testId}>
			<Slider
				aria-label={label}
				className="min-w-12 flex-1"
				value={[value]}
				min={MIN_LEVEL_DB}
				max={MAX_LEVEL_DB}
				step={0.1}
				onPointerDown={gesture.onPointerDown}
				onValueChange={gesture.onValueChange}
				onValueCommit={gesture.onValueCommit}
				onDoubleClick={() => handlers.onChange(0, false)}
			/>
			<Input
				aria-label={label}
				className="h-6 w-14 rounded-sm px-1 text-right text-[11px] tabular-nums"
				data-testid={`${testId}-value`}
				value={draft ?? formatLevel(value)}
				onFocus={(event) => {
					setDraft(value.toFixed(1));
					event.currentTarget.select();
				}}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commitDraft}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
					if (event.key === "Escape") {
						setDraft(null);
						event.currentTarget.blur();
					}
				}}
			/>
			<span className="w-4 text-[9px] text-muted-foreground">dB</span>
		</div>
	);
}

/** Pan from -1 (left) to 1 (right); double-click centres it. */
export function PanControl({
	label,
	value,
	testId,
	...handlers
}: MixGestureHandlers & {
	label: string;
	value: number;
	testId: string;
}) {
	const gesture = useMixGesture(handlers);
	return (
		<div className="flex min-w-0 items-center gap-1.5" data-testid={testId}>
			<Slider
				aria-label={label}
				className="min-w-10 flex-1"
				value={[value]}
				min={-1}
				max={1}
				step={0.01}
				onPointerDown={gesture.onPointerDown}
				onValueChange={gesture.onValueChange}
				onValueCommit={gesture.onValueCommit}
				onDoubleClick={() => handlers.onChange(0, false)}
			/>
			<span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
				{formatPan(value)}
			</span>
		</div>
	);
}

function meterPercent(db: number): string {
	return `${Math.min(100, Math.max(0, ((db + 60) / 60) * 100))}%`;
}

/** Peak bar with an RMS tick, and gain reduction when something compresses. */
export function LevelMeter({
	reading,
	duckingDb = 0,
	testId,
}: {
	reading: AudioMeterReading;
	duckingDb?: number;
	testId?: string;
}) {
	const reduction = Math.min(reading.gainReductionDb, duckingDb);
	return (
		<div className="flex items-center gap-1.5" data-testid={testId}>
			<div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
				<div
					className={cn(
						"absolute inset-y-0 left-0 transition-[width] duration-75",
						reading.clipping ? "bg-destructive" : "bg-emerald-500"
					)}
					style={{ width: meterPercent(reading.peakDb) }}
				/>
				{reading.rmsDb > -60 ? (
					<div
						className="absolute inset-y-0 w-px bg-foreground/80"
						style={{ left: meterPercent(reading.rmsDb) }}
					/>
				) : null}
			</div>
			<span
				className={cn(
					"w-8 text-right text-[9px] tabular-nums",
					reduction < -0.5 ? "text-amber-500" : "text-transparent"
				)}
			>
				{reduction.toFixed(1)}
			</span>
		</div>
	);
}

/** A small lettered switch: M (mute), S (solo). */
export function LetterToggle({
	letter,
	pressed,
	label,
	activeClassName,
	onToggle,
	testId,
}: {
	letter: string;
	pressed: boolean;
	label: string;
	activeClassName: string;
	onToggle: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			data-testid={testId}
			className={cn(
				"grid size-5 shrink-0 place-items-center rounded-sm border border-border/70 text-[10px] font-semibold leading-none text-muted-foreground hover:text-foreground",
				pressed && activeClassName
			)}
			onClick={onToggle}
		>
			{letter}
		</button>
	);
}
