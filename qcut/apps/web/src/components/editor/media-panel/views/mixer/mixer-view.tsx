import { Plus } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { resolveAudioMixRouting } from "@/lib/audio/audio-mix-routing";
import { normalizeProjectAudioMixSettings } from "@/lib/audio/audio-mix-settings";
import { useTranslation } from "@/lib/i18n";
import { carriesAudio, createMixBus } from "@/stores/audio-mix-actions";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { MixerBusRow } from "./mixer-bus-row";
import { MixerLoudness } from "./mixer-loudness";
import { MixerTrackRow, reportMixError } from "./mixer-track-row";

/**
 * The mixer: every audio track's strip, the buses they feed, and the master
 * with its loudness. Everything here goes through stores/audio-mix-actions.ts,
 * the same actions the editor API uses.
 */
export function MixerView() {
	const { t } = useTranslation();
	const tracks = useTimelineStore((state) => state.tracks);
	const audioMix = useProjectStore((state) => state.activeProject?.audioMix);
	const mix = useMemo(
		() => normalizeProjectAudioMixSettings({ audioMix }),
		[audioMix]
	);
	const audioTracks = useMemo(() => tracks.filter(carriesAudio), [tracks]);
	const silenced = useMemo(
		() =>
			new Map(
				resolveAudioMixRouting({
					tracks: audioTracks,
					audioMix: mix,
				}).tracks.map((route) => [route.trackId, route.silenced])
			),
		[audioTracks, mix]
	);

	const addBus = () => {
		const names = new Set(mix.buses.map((bus) => bus.name.toLowerCase()));
		let number = mix.buses.length + 1;
		while (names.has(t("mixer.newBusName", { number }).toLowerCase())) {
			number += 1;
		}
		createMixBus({
			patch: { name: t("mixer.newBusName", { number }) },
		}).catch(reportMixError);
	};

	return (
		<div className="space-y-4 p-3" data-testid="mixer-view">
			<section className="space-y-2">
				<h3 className="text-xs font-medium text-muted-foreground">
					{t("mixer.tracks")}
				</h3>
				{audioTracks.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						{t("mixer.noAudioTracks")}
					</p>
				) : null}
				{audioTracks.map((track) => (
					<MixerTrackRow
						key={track.id}
						track={track}
						buses={mix.buses}
						otherTracks={audioTracks.filter((other) => other.id !== track.id)}
						silenced={silenced.get(track.id) === true}
					/>
				))}
			</section>

			<section className="space-y-2">
				<div className="flex items-center justify-between">
					<h3 className="text-xs font-medium text-muted-foreground">
						{t("mixer.buses")}
					</h3>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-6 gap-1 px-2 text-[11px]"
						onClick={addBus}
						data-testid="mixer-add-bus"
					>
						<Plus className="size-3" />
						{t("mixer.addBus")}
					</Button>
				</div>
				{mix.buses.length === 0 ? (
					<p className="text-[11px] text-muted-foreground">
						{t("mixer.noBuses")}
					</p>
				) : null}
				{mix.buses.map((bus) => (
					<MixerBusRow key={bus.id} bus={bus} />
				))}
			</section>

			<section className="space-y-2">
				<h3 className="text-xs font-medium text-muted-foreground">
					{t("mixer.master")}
				</h3>
				<MixerBusRow bus={mix.master}>
					<MixerLoudness />
				</MixerBusRow>
			</section>
		</div>
	);
}
