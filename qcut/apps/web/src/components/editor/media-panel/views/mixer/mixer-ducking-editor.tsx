import { useRef } from "react";
import {
	AudioModuleSection,
	AudioNumberControl,
} from "@/components/editor/properties-panel/audio/audio-property-controls";
import { Checkbox } from "@/components/ui/checkbox";
import { createDefaultTrackAudioSettings } from "@/lib/audio/audio-mix-settings";
import { useTranslation } from "@/lib/i18n";
import type { AudioDuckingSettings, TimelineTrack } from "@/types/timeline";

/**
 * Which tracks this one ducks under, and how: while any of them is above the
 * threshold, the track drops by the reduction, gliding over attack and
 * release.
 */
export function MixDuckingEditor({
	ducking,
	otherTracks,
	onChange,
	onGestureStart,
	testId,
}: {
	ducking: AudioDuckingSettings;
	otherTracks: TimelineTrack[];
	onChange: (patch: Partial<AudioDuckingSettings>, inGesture: boolean) => void;
	onGestureStart?: () => void;
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
			inGesture.current = false;
		},
	};
	const change = (patch: Partial<AudioDuckingSettings>) =>
		onChange(patch, inGesture.current);
	const sources = new Set(ducking.sourceTrackIds);

	return (
		<div className="w-72 px-1" data-testid={testId}>
			<AudioModuleSection
				title={t("mixer.ducking")}
				enabled={ducking.enabled}
				onEnabledChange={(enabled) => change({ enabled })}
				onReset={() => change(createDefaultTrackAudioSettings().ducking)}
				defaultExpanded
				testId={`${testId}-section`}
			>
				<fieldset className="space-y-1.5">
					<legend className="mb-1 text-[11px] text-muted-foreground">
						{t("mixer.duckUnder")}
					</legend>
					{otherTracks.length === 0 ? (
						<p className="text-[11px] text-muted-foreground">
							{t("mixer.noDuckingSources")}
						</p>
					) : null}
					{otherTracks.map((track) => {
						const id = `${testId}-${track.id}`;
						return (
							<label
								key={track.id}
								htmlFor={id}
								className="flex items-center gap-2 text-[11px]"
							>
								<Checkbox
									id={id}
									checked={sources.has(track.id)}
									onCheckedChange={(checked) =>
										change({
											sourceTrackIds:
												checked === true
													? [...sources, track.id]
													: [...sources].filter(
															(sourceId) => sourceId !== track.id
														),
										})
									}
								/>
								<span className="truncate">{track.name}</span>
							</label>
						);
					})}
				</fieldset>
				<AudioNumberControl
					label={t("mixer.threshold")}
					value={ducking.thresholdDb}
					min={-90}
					max={0}
					suffix="dB"
					onChange={(thresholdDb) => change({ thresholdDb })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.reduction")}
					value={ducking.reductionDb}
					min={-60}
					max={0}
					suffix="dB"
					onChange={(reductionDb) => change({ reductionDb })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.attack")}
					value={ducking.attackMs}
					min={1}
					max={2_000}
					suffix="ms"
					onChange={(attackMs) => change({ attackMs })}
					{...gesture}
				/>
				<AudioNumberControl
					label={t("mixer.release")}
					value={ducking.releaseMs}
					min={1}
					max={5_000}
					suffix="ms"
					onChange={(releaseMs) => change({ releaseMs })}
					{...gesture}
				/>
			</AudioModuleSection>
		</div>
	);
}
