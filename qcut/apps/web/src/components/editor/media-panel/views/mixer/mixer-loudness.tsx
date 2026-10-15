import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MixLoudness } from "@/lib/audio/mix-loudness";
import { measureProjectMixLoudness } from "@/lib/audio/project-mix-loudness";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAudioMeterStore } from "@/stores/editor/audio-meter-store";
import { usePlaybackStore } from "@/stores/editor/playback-store";

/**
 * The master's loudness. While the timeline plays, live estimates from the
 * master meter: momentary, the last 3 s, and the gated average since play
 * started. "Measure the mix" renders the whole mix as an export would and
 * reads it exactly (BS.1770-4), the same as `qcut editor mix loudness`.
 */

const READINGS_PER_SHORT_TERM = 60; // 3 s of 50 ms meter readings
const READINGS_PER_BLOCK = 8; // ~400 ms

function toLufs(energy: number): number {
	return energy > 0 ? Math.max(-120, -0.691 + 10 * Math.log10(energy)) : -120;
}

function toEnergy(lufs: number): number {
	return lufs <= -120 ? 0 : 10 ** ((lufs + 0.691) / 10);
}

function mean(values: number[]): number {
	return values.length === 0
		? 0
		: values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** BS.1770 gating over the blocks heard so far. */
function gatedLufs(blocks: number[]): number {
	const audible = blocks.filter((energy) => toLufs(energy) >= -70);
	if (audible.length === 0) return -120;
	const gate = toLufs(mean(audible)) - 10;
	return toLufs(mean(audible.filter((energy) => toLufs(energy) >= gate)));
}

interface LiveLoudness {
	momentary: number;
	shortTerm: number;
	integrated: number;
}

const SILENT_LIVE: LiveLoudness = {
	momentary: -120,
	shortTerm: -120,
	integrated: -120,
};

function useLiveLoudness(): LiveLoudness {
	const isPlaying = usePlaybackStore((state) => state.isPlaying);
	const [live, setLive] = useState(SILENT_LIVE);
	useEffect(() => {
		if (!isPlaying) return;
		const recent: number[] = [];
		const blocks: number[] = [];
		let block: number[] = [];
		setLive(SILENT_LIVE);
		return useAudioMeterStore.subscribe((state, previous) => {
			if (state.master === previous.master) return;
			const reading = state.master;
			const energy = toEnergy(reading.lufsMomentary);
			recent.push(energy);
			if (recent.length > READINGS_PER_SHORT_TERM) recent.shift();
			block.push(energy);
			if (block.length === READINGS_PER_BLOCK) {
				blocks.push(mean(block));
				block = [];
			}
			setLive({
				momentary: reading.lufsMomentary,
				shortTerm: toLufs(mean(recent)),
				integrated: gatedLufs(blocks),
			});
		});
	}, [isPlaying]);
	return live;
}

function format(value: number, unit: string): string {
	return value <= -119 ? `-∞ ${unit}` : `${value.toFixed(1)} ${unit}`;
}

function Reading({
	label,
	value,
	unit,
	warn = false,
	testId,
}: {
	label: string;
	value: number;
	unit: string;
	warn?: boolean;
	testId: string;
}) {
	return (
		<div className="flex items-baseline justify-between gap-2 text-[11px]">
			<span className="text-muted-foreground">{label}</span>
			<span
				className={cn("tabular-nums", warn && "text-amber-500")}
				data-testid={testId}
			>
				{format(value, unit)}
			</span>
		</div>
	);
}

export function MixerLoudness() {
	const { t } = useTranslation();
	const live = useLiveLoudness();
	const [measured, setMeasured] = useState<MixLoudness | null>(null);
	const [measuring, setMeasuring] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const measure = async () => {
		setMeasuring(true);
		setError(null);
		try {
			setMeasured(await measureProjectMixLoudness());
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setMeasuring(false);
		}
	};

	return (
		<div
			className="space-y-2 border-t border-border/60 pt-2"
			data-testid="mixer-loudness"
		>
			<div className="space-y-1">
				<div className="text-[11px] font-medium">
					{t("mixer.loudness")} · {t("mixer.loudnessLive")}
				</div>
				<Reading
					label={t("mixer.momentary")}
					value={live.momentary}
					unit="LUFS"
					testId="mixer-loudness-momentary"
				/>
				<Reading
					label={t("mixer.shortTerm")}
					value={live.shortTerm}
					unit="LUFS"
					testId="mixer-loudness-short-term"
				/>
				<Reading
					label={t("mixer.integrated")}
					value={live.integrated}
					unit="LUFS"
					testId="mixer-loudness-integrated"
				/>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-7 w-full gap-1.5 text-[11px]"
				disabled={measuring}
				onClick={measure}
				data-testid="mixer-loudness-measure"
			>
				<Gauge className="size-3.5" />
				{measuring ? t("mixer.measuring") : t("mixer.measure")}
			</Button>
			{error ? (
				<p className="text-[11px] text-destructive">
					{t("mixer.measureFailed", { error })}
				</p>
			) : null}
			{measured ? (
				<div className="space-y-1" data-testid="mixer-loudness-measured">
					<div className="text-[11px] text-muted-foreground">
						{t("mixer.measured")}
					</div>
					<Reading
						label={t("mixer.integrated")}
						value={measured.integratedLufs}
						unit="LUFS"
						warn={measured.integratedLufs > -13}
						testId="mixer-loudness-measured-integrated"
					/>
					<Reading
						label={t("mixer.loudestShortTerm")}
						value={measured.maxShortTermLufs}
						unit="LUFS"
						testId="mixer-loudness-measured-short-term"
					/>
					<Reading
						label={t("mixer.truePeak")}
						value={measured.truePeakDbtp}
						unit="dBTP"
						warn={measured.truePeakDbtp > -1}
						testId="mixer-loudness-measured-true-peak"
					/>
					<p className="text-[10px] text-muted-foreground">
						{t("mixer.loudnessTarget")}
					</p>
				</div>
			) : null}
		</div>
	);
}
