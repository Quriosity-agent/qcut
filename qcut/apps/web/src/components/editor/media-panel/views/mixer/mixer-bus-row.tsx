import { Sparkles, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { AudioBusPatch } from "@/lib/audio/audio-mix-patch";
import { SILENT_AUDIO_METER } from "@/lib/audio/audio-metering";
import { MASTER_AUDIO_BUS_ID } from "@/lib/audio/audio-mix-settings";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
	removeMixBus,
	setTrackMix,
	updateMixBus,
} from "@/stores/audio-mix-actions";
import { useAudioMeterStore } from "@/stores/editor/audio-meter-store";
import type { AudioMixBusSettings } from "@/types/timeline";
import {
	LetterToggle,
	LevelFader,
	LevelMeter,
	PanControl,
} from "./mixer-controls";
import { MixEffectsEditor } from "./mixer-effects-editor";
import { MIXER_TRACK_DRAG_TYPE, reportMixError } from "./mixer-track-row";

/**
 * Bus and master changes. A drag changes what plays without saving; its
 * release saves (see stores/audio-mix-actions.ts).
 */
function changeBus({
	busId,
	patch,
	inGesture = false,
}: {
	busId: string;
	patch: AudioBusPatch;
	inGesture?: boolean;
}) {
	updateMixBus({ busId, patch, save: !inGesture }).catch(reportMixError);
}

function BusName({ bus }: { bus: AudioMixBusSettings }) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		const name = draft?.trim();
		setDraft(null);
		if (name && name !== bus.name)
			changeBus({ busId: bus.id, patch: { name } });
	};
	return (
		<Input
			aria-label={t("mixer.busName")}
			className="h-6 min-w-0 flex-1 rounded-sm border-transparent bg-transparent px-1 text-xs hover:border-border focus:border-border"
			data-testid={`mixer-bus-${bus.id}-name`}
			value={draft ?? bus.name}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					setDraft(null);
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

/** A bus, or the master: meter, mute, solo, effects, level, pan; tracks drop onto it. */
export function MixerBusRow({
	bus,
	children,
}: {
	bus: AudioMixBusSettings;
	/** Extra rows below the controls (the master's loudness). */
	children?: ReactNode;
}) {
	const { t } = useTranslation();
	const isMaster = bus.id === MASTER_AUDIO_BUS_ID;
	const name = isMaster ? t("mixer.master") : bus.name;
	const reading = useAudioMeterStore((state) =>
		isMaster ? state.master : (state.buses[bus.id] ?? SILENT_AUDIO_METER)
	);
	const [dropping, setDropping] = useState(false);
	const testId = `mixer-bus-${bus.id}`;

	return (
		<div
			className={cn(
				"space-y-1.5 rounded-md border border-border/60 bg-foreground/[0.03] p-2",
				dropping && "border-primary bg-primary/10"
			)}
			data-testid={testId}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes(MIXER_TRACK_DRAG_TYPE)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "link";
				setDropping(true);
			}}
			onDragLeave={() => setDropping(false)}
			onDrop={(event) => {
				setDropping(false);
				const trackId = event.dataTransfer.getData(MIXER_TRACK_DRAG_TYPE);
				if (!trackId) return;
				event.preventDefault();
				try {
					setTrackMix({ trackId, patch: { busId: bus.id } });
				} catch (error) {
					reportMixError(error);
				}
			}}
		>
			<div className="flex items-center gap-1.5">
				{isMaster ? (
					<span className="min-w-0 flex-1 truncate text-xs font-medium">
						{name}
					</span>
				) : (
					<BusName bus={bus} />
				)}
				<LetterToggle
					letter="M"
					pressed={bus.muted}
					label={
						bus.muted ? t("mixer.unmute", { name }) : t("mixer.mute", { name })
					}
					activeClassName="border-destructive/60 bg-destructive/15 text-destructive"
					onToggle={() =>
						changeBus({ busId: bus.id, patch: { muted: !bus.muted } })
					}
					testId={`${testId}-mute`}
				/>
				{isMaster ? null : (
					<LetterToggle
						letter="S"
						pressed={bus.solo}
						label={
							bus.solo ? t("mixer.unsolo", { name }) : t("mixer.solo", { name })
						}
						activeClassName="border-amber-500/60 bg-amber-500/15 text-amber-500"
						onToggle={() =>
							changeBus({ busId: bus.id, patch: { solo: !bus.solo } })
						}
						testId={`${testId}-solo`}
					/>
				)}
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
							effects={bus.effects}
							testId={`${testId}-effects-editor`}
							onChange={(effects, inGesture) =>
								changeBus({ busId: bus.id, patch: { effects }, inGesture })
							}
							onGestureEnd={() => changeBus({ busId: bus.id, patch: {} })}
						/>
					</PopoverContent>
				</Popover>
				{isMaster ? null : (
					<Button
						type="button"
						variant="text"
						size="icon"
						className="size-5"
						aria-label={t("mixer.removeBus", { name })}
						title={t("mixer.removeBus", { name })}
						data-testid={`${testId}-remove`}
						onClick={() =>
							removeMixBus({ busId: bus.id }).catch(reportMixError)
						}
					>
						<Trash2 className="size-3" />
					</Button>
				)}
			</div>
			<LevelMeter reading={reading} testId={`${testId}-meter`} />
			<LevelFader
				label={t("mixer.levelOf", { name })}
				value={bus.gainDb}
				testId={`${testId}-level`}
				onChange={(gainDb, inGesture) =>
					changeBus({ busId: bus.id, patch: { gainDb }, inGesture })
				}
				onGestureEnd={(gainDb) =>
					changeBus({ busId: bus.id, patch: { gainDb } })
				}
			/>
			<PanControl
				label={t("mixer.panOf", { name })}
				value={bus.pan}
				testId={`${testId}-pan`}
				onChange={(pan, inGesture) =>
					changeBus({ busId: bus.id, patch: { pan }, inGesture })
				}
				onGestureEnd={(pan) => changeBus({ busId: bus.id, patch: { pan } })}
			/>
			{children}
		</div>
	);
}
