import { AudioWaveform, GripVertical, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SILENT_AUDIO_METER } from "@/lib/audio/audio-metering";
import {
	MASTER_AUDIO_BUS_ID,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import { useTranslation } from "@/lib/i18n";
import { localizeTrackName } from "@/lib/i18n/timeline-names";
import {
	getTimelineColorLabelColor,
	resolveTimelineColorLabel,
} from "@/lib/timeline/timeline-color-labels";
import { cn } from "@/lib/utils";
import { markTrackMixUndoPoint, setTrackMix } from "@/stores/audio-mix-actions";
import { useAudioMeterStore } from "@/stores/editor/audio-meter-store";
import type { AudioMixBusSettings, TimelineTrack } from "@/types/timeline";
import {
	LetterToggle,
	LevelFader,
	LevelMeter,
	PanControl,
} from "./mixer-controls";
import { MixDuckingEditor } from "./mixer-ducking-editor";
import { MixEffectsEditor } from "./mixer-effects-editor";

/** Drag data type for sending a track to a bus by dropping it there. */
export const MIXER_TRACK_DRAG_TYPE = "application/x-qcut-mixer-track";

export function reportMixError(error: unknown) {
	toast.error(error instanceof Error ? error.message : String(error));
}

function changeTrack({
	trackId,
	patch,
	inGesture = false,
}: {
	trackId: string;
	patch: Parameters<typeof setTrackMix>[0]["patch"];
	inGesture?: boolean;
}) {
	try {
		setTrackMix({ trackId, patch, history: !inGesture });
	} catch (error) {
		reportMixError(error);
	}
}

/** Level, pan and output of one track: the mixer row and the track header use it. */
export function TrackMixControls({
	track,
	buses,
	testIdPrefix,
}: {
	track: TimelineTrack;
	buses: AudioMixBusSettings[];
	testIdPrefix: string;
}) {
	const { locale, t } = useTranslation();
	const name = localizeTrackName({ track, locale });
	const settings = normalizeTrackAudioSettings({ audio: track.audio });
	const output = buses.some((bus) => bus.id === settings.busId)
		? settings.busId
		: MASTER_AUDIO_BUS_ID;
	return (
		<div className="space-y-1.5">
			<LevelFader
				label={t("mixer.levelOf", { name })}
				value={settings.gainDb}
				testId={`${testIdPrefix}-level`}
				onGestureStart={markTrackMixUndoPoint}
				onChange={(gainDb, inGesture) =>
					changeTrack({ trackId: track.id, patch: { gainDb }, inGesture })
				}
			/>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<PanControl
						label={t("mixer.panOf", { name })}
						value={settings.pan}
						testId={`${testIdPrefix}-pan`}
						onGestureStart={markTrackMixUndoPoint}
						onChange={(pan, inGesture) =>
							changeTrack({ trackId: track.id, patch: { pan }, inGesture })
						}
					/>
				</div>
				<Select
					value={output}
					onValueChange={(busId) =>
						changeTrack({ trackId: track.id, patch: { busId } })
					}
				>
					<SelectTrigger
						aria-label={t("mixer.outputOf", { name })}
						className="h-6 w-28 shrink-0 px-2 text-[11px]"
						data-testid={`${testIdPrefix}-output`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={MASTER_AUDIO_BUS_ID}>
							{t("mixer.master")}
						</SelectItem>
						{buses.map((bus) => (
							<SelectItem key={bus.id} value={bus.id}>
								{bus.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

/** One audio track in the mixer: meter, mute, solo, effects, ducking, level, pan, output. */
export function MixerTrackRow({
	track,
	buses,
	otherTracks,
	silenced,
}: {
	track: TimelineTrack;
	buses: AudioMixBusSettings[];
	otherTracks: TimelineTrack[];
	silenced: boolean;
}) {
	const { locale, t } = useTranslation();
	const name = localizeTrackName({ track, locale });
	const settings = normalizeTrackAudioSettings({ audio: track.audio });
	const reading = useAudioMeterStore(
		(state) => state.tracks[track.id] ?? SILENT_AUDIO_METER
	);
	const duckingDb = useAudioMeterStore(
		(state) => state.duckingReductionDb[track.id] ?? 0
	);
	const colorLabel = resolveTimelineColorLabel({ value: track.colorLabel });
	const testId = `mixer-track-${track.id}`;
	const ducking = settings.ducking;
	const ducks = ducking.enabled && ducking.sourceTrackIds.length > 0;

	return (
		<div
			className={cn(
				"space-y-1.5 rounded-md border border-border/60 bg-foreground/[0.03] p-2",
				silenced && "opacity-60"
			)}
			data-testid={testId}
			data-silenced={silenced || undefined}
		>
			<div className="flex items-center gap-1.5">
				<span
					draggable
					role="img"
					aria-label={t("mixer.dragToBus", { name })}
					title={t("mixer.dragToBus", { name })}
					className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground"
					data-testid={`${testId}-drag`}
					onDragStart={(event) => {
						event.dataTransfer.setData(MIXER_TRACK_DRAG_TYPE, track.id);
						event.dataTransfer.effectAllowed = "link";
					}}
				>
					<GripVertical className="size-3" />
				</span>
				<span
					className="size-2 shrink-0 rounded-full bg-muted-foreground/40"
					style={
						colorLabel
							? {
									backgroundColor: getTimelineColorLabelColor({ colorLabel }),
								}
							: undefined
					}
				/>
				<span className="min-w-0 flex-1 truncate text-xs" title={name}>
					{name}
				</span>
				{silenced ? (
					<span className="text-[10px] text-muted-foreground">
						{t("mixer.silenced")}
					</span>
				) : null}
				<LetterToggle
					letter="M"
					pressed={track.muted === true}
					label={
						track.muted
							? t("mixer.unmute", { name })
							: t("mixer.mute", { name })
					}
					activeClassName="border-destructive/60 bg-destructive/15 text-destructive"
					onToggle={() =>
						changeTrack({ trackId: track.id, patch: { muted: !track.muted } })
					}
					testId={`${testId}-mute`}
				/>
				<LetterToggle
					letter="S"
					pressed={settings.solo}
					label={
						settings.solo
							? t("mixer.unsolo", { name })
							: t("mixer.solo", { name })
					}
					activeClassName="border-amber-500/60 bg-amber-500/15 text-amber-500"
					onToggle={() =>
						changeTrack({ trackId: track.id, patch: { solo: !settings.solo } })
					}
					testId={`${testId}-solo`}
				/>
				<Popover>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="text"
							size="icon"
							className="size-5"
							aria-label={t("mixer.effectsOf", { name })}
							title={t("mixer.effectsOf", { name })}
							data-testid={`${testId}-effects`}
						>
							<Sparkles className="size-3" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="max-h-[70vh] overflow-y-auto">
						<MixEffectsEditor
							effects={settings.effects}
							testId={`${testId}-effects-editor`}
							onGestureStart={markTrackMixUndoPoint}
							onChange={(effects, inGesture) =>
								changeTrack({
									trackId: track.id,
									patch: { effects },
									inGesture,
								})
							}
						/>
					</PopoverContent>
				</Popover>
				<Popover>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant={ducks ? "secondary" : "text"}
							size="icon"
							className="size-5"
							aria-label={t("mixer.duckingOf", { name })}
							title={
								ducks
									? t("mixer.duckingActive", {
											count: ducking.sourceTrackIds.length,
										})
									: t("mixer.duckingOf", { name })
							}
							data-testid={`${testId}-ducking`}
						>
							<AudioWaveform className="size-3" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="max-h-[70vh] overflow-y-auto">
						<MixDuckingEditor
							ducking={ducking}
							otherTracks={otherTracks}
							testId={`${testId}-ducking-editor`}
							onGestureStart={markTrackMixUndoPoint}
							onChange={(patch, inGesture) =>
								changeTrack({
									trackId: track.id,
									patch: { ducking: patch },
									inGesture,
								})
							}
						/>
					</PopoverContent>
				</Popover>
			</div>
			<LevelMeter
				reading={reading}
				duckingDb={duckingDb}
				testId={`${testId}-meter`}
			/>
			<TrackMixControls track={track} buses={buses} testIdPrefix={testId} />
		</div>
	);
}
