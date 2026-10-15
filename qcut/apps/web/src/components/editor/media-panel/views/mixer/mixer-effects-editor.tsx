import { useRef } from "react";
import {
	AudioModuleSection,
	AudioNumberControl,
} from "@/components/editor/properties-panel/audio/audio-property-controls";
import type { AudioEffectsPatch } from "@/lib/audio/audio-mix-patch";
import {
	createDefaultCompressorSettings,
	createDefaultLimiterSettings,
	createDefaultParametricEqualizerSettings,
} from "@/lib/audio/audio-mix-settings";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import type { AudioBusEffectsSettings } from "@/types/timeline";

const BAND_LABEL_KEYS: Record<string, TranslationKey> = {
	low: "mixer.band.low",
	body: "mixer.band.body",
	presence: "mixer.band.presence",
	air: "mixer.band.air",
};

function formatFrequency(hz: number): string {
	return hz >= 1_000 ? `${(hz / 1_000).toFixed(hz % 1_000 ? 1 : 0)}k` : `${hz}`;
}

/**
 * EQ, compressor and limiter of a track, bus or the master. Changes arrive as
 * patches; a slider drag is one gesture (see mixer-controls.tsx).
 */
export function MixEffectsEditor({
	effects,
	onChange,
	onGestureStart,
	onGestureEnd,
	testId,
}: {
	effects: AudioBusEffectsSettings;
	onChange: (patch: AudioEffectsPatch, inGesture: boolean) => void;
	onGestureStart?: () => void;
	onGestureEnd?: () => void;
	testId: string;
}) {
	const { t } = useTranslation();
	const inGesture = useRef(false);
	const gesture = {
		onInteractionStart: () => {
			if (inGesture.current) return;
			inGesture.current = true;
			onGestureStart?.();
		},
		onInteractionEnd: () => {
			if (!inGesture.current) return;
			inGesture.current = false;
			onGestureEnd?.();
		},
	};
	const change = (patch: AudioEffectsPatch) =>
		onChange(patch, inGesture.current);
	const { parametricEqualizer: equalizer, compressor, limiter } = effects;

	return (
		<div className="w-72 px-1" data-testid={testId}>
			<AudioModuleSection
				title={t("mixer.equalizer")}
				enabled={equalizer.enabled}
				onEnabledChange={(enabled) =>
					change({ parametricEqualizer: { enabled } })
				}
				onReset={() =>
					change({
						parametricEqualizer: createDefaultParametricEqualizerSettings(),
					})
				}
				testId={`${testId}-eq`}
			>
				<AudioNumberControl
					label={t("mixer.lowCut")}
					value={equalizer.lowCutHz}
					min={20}
					max={2_000}
					suffix="Hz"
					onChange={(lowCutHz) => change({ parametricEqualizer: { lowCutHz } })}
					{...gesture}
				/>
				{equalizer.bands.map((band) => (
					<AudioNumberControl
						key={band.id}
						label={`${BAND_LABEL_KEYS[band.id] ? t(BAND_LABEL_KEYS[band.id]) : band.id} ${formatFrequency(band.frequencyHz)}`}
						value={band.gainDb}
						min={-24}
						max={24}
						step={0.5}
						suffix="dB"
						onChange={(gainDb) =>
							change({
								parametricEqualizer: { bands: [{ id: band.id, gainDb }] },
							})
						}
						{...gesture}
					/>
				))}
				<AudioNumberControl
					label={t("mixer.highCut")}
					value={equalizer.highCutHz}
					min={2_000}
					max={20_000}
					step={100}
					suffix="Hz"
					onChange={(highCutHz) =>
						change({ parametricEqualizer: { highCutHz } })
					}
					{...gesture}
				/>
			</AudioModuleSection>

			<AudioModuleSection
				title={t("mixer.compressor")}
				enabled={compressor.enabled}
				onEnabledChange={(enabled) => change({ compressor: { enabled } })}
				onReset={() =>
					change({ compressor: createDefaultCompressorSettings() })
				}
				testId={`${testId}-compressor`}
			>
				<AudioNumberControl
					label={t("mixer.threshold")}
					value={compressor.thresholdDb}
					min={-60}
					max={0}
					suffix="dB"
					onChange={(thresholdDb) => change({ compressor: { thresholdDb } })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.ratio")}
					value={compressor.ratio}
					min={1}
					max={20}
					step={0.1}
					suffix=":1"
					onChange={(ratio) => change({ compressor: { ratio } })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.attack")}
					value={compressor.attackMs}
					min={0}
					max={1_000}
					suffix="ms"
					onChange={(attackMs) => change({ compressor: { attackMs } })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.release")}
					value={compressor.releaseMs}
					min={0}
					max={1_000}
					suffix="ms"
					onChange={(releaseMs) => change({ compressor: { releaseMs } })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.makeup")}
					value={compressor.makeupGainDb}
					min={0}
					max={24}
					step={0.5}
					suffix="dB"
					onChange={(makeupGainDb) => change({ compressor: { makeupGainDb } })}
					{...gesture}
				/>
			</AudioModuleSection>

			<AudioModuleSection
				title={t("mixer.limiter")}
				enabled={limiter.enabled}
				onEnabledChange={(enabled) => change({ limiter: { enabled } })}
				onReset={() => change({ limiter: createDefaultLimiterSettings() })}
				testId={`${testId}-limiter`}
			>
				<AudioNumberControl
					label={t("mixer.ceiling")}
					value={limiter.ceilingDb}
					min={-24}
					max={0}
					step={0.1}
					suffix="dB"
					onChange={(ceilingDb) => change({ limiter: { ceilingDb } })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.release")}
					value={limiter.releaseMs}
					min={0}
					max={1_000}
					suffix="ms"
					onChange={(releaseMs) => change({ limiter: { releaseMs } })}
					{...gesture}
				/>
			</AudioModuleSection>
		</div>
	);
}
