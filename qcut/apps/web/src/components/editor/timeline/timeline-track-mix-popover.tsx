import { SlidersVertical } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { formatLevel } from "@/components/editor/media-panel/views/mixer/mixer-controls";
import { TrackMixControls } from "@/components/editor/media-panel/views/mixer/mixer-track-row";
import { useMediaPanelStore } from "@/components/editor/media-panel/store";
import {
	normalizeProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";
import type { TimelineTrack } from "@/types/timeline";

/**
 * A track header's mix button: shows the track's level when it is not 0 dB
 * and opens its level, pan and output, the same controls as the mixer.
 */
export function TimelineTrackMixPopover({
	track,
	displayName,
}: {
	track: TimelineTrack;
	displayName: string;
}) {
	const { t } = useTranslation();
	const audioMix = useProjectStore((state) => state.activeProject?.audioMix);
	const buses = useMemo(
		() => normalizeProjectAudioMixSettings({ audioMix }).buses,
		[audioMix]
	);
	const level = normalizeTrackAudioSettings({ audio: track.audio }).gainDb;
	const label = t("mixer.trackMix", {
		name: displayName,
		level: `${formatLevel(level)} dB`,
	});
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex h-5 shrink-0 items-center gap-0.5 rounded-sm px-0.5 text-muted-foreground hover:text-foreground",
						level !== 0 && "text-foreground"
					)}
					aria-label={label}
					title={label}
					data-testid="timeline-track-mix"
					onClick={(event) => event.stopPropagation()}
				>
					<SlidersVertical className="size-3.5" />
					{level !== 0 ? (
						<span className="text-[9px] tabular-nums">
							{formatLevel(level)}
						</span>
					) : null}
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72 space-y-2 p-3"
				onClick={(event) => event.stopPropagation()}
				data-testid="timeline-track-mix-popover"
			>
				<div className="truncate text-xs font-medium">{displayName}</div>
				<TrackMixControls
					track={track}
					buses={buses}
					testIdPrefix={`timeline-track-mix-${track.id}`}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 w-full text-[11px]"
					onClick={() => useMediaPanelStore.getState().setActiveTab("mixer")}
				>
					{t("mixer.openMixer")}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
