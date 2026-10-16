import { platform } from "@qcut/platform-core";
import { expandCompoundMediaTracks } from "@/lib/timeline/compound-media";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { encodeAudioBufferAsWav } from "./audio-buffer-wav";
import { resolveAudioMixRouting } from "./audio-mix-routing";
import { MASTER_AUDIO_BUS_ID } from "./audio-mix-settings";
import { renderBrowserTimelineAudio } from "./browser-audio-export";

export interface MixStem {
	/** The bus, or "master" for the tracks that feed the master directly. */
	busId: string;
	name: string;
	path: string;
	trackIds: string[];
}

/** Stems beside an export: `<folder>/<name>-<bus>.wav`. */
export function stemsBesideExportPath(outputPath: string): {
	outputDir: string;
	fileNamePrefix: string;
} {
	const separator = Math.max(
		outputPath.lastIndexOf("/"),
		outputPath.lastIndexOf("\\")
	);
	const fileName = outputPath.slice(separator + 1);
	const dot = fileName.lastIndexOf(".");
	return {
		outputDir: separator >= 0 ? outputPath.slice(0, separator) : ".",
		fileNamePrefix: `${dot > 0 ? fileName.slice(0, dot) : fileName}-`,
	};
}

function safeFileName(text: string): string {
	return (
		text.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "stem"
	);
}

/**
 * Writes one WAV per bus that something is heard on, plus one for the tracks
 * feeding the master directly ("direct"), into `outputDir`, each named
 * `<fileNamePrefix><bus name>.wav`. Each is as long as the programme and
 * lines up with it, so the stems summed through the master give the mix.
 */
export async function renderProjectMixStems({
	outputDir,
	fileNamePrefix = "",
}: {
	outputDir: string;
	fileNamePrefix?: string;
}): Promise<MixStem[]> {
	const project = useProjectStore.getState().activeProject;
	const timeline = useTimelineStore.getState();
	const tracks = expandCompoundMediaTracks({ tracks: timeline.tracks });
	const routing = resolveAudioMixRouting({
		tracks,
		audioMix: project?.audioMix,
	});
	const heard = routing.tracks.filter((route) => !route.silenced);
	const stems = [
		...routing.buses.map((bus) => ({
			busId: bus.settings.id,
			name: bus.settings.name,
		})),
		{ busId: MASTER_AUDIO_BUS_ID, name: "direct" },
	].flatMap((stem) => {
		const trackIds = heard
			.filter((route) => route.busId === stem.busId)
			.map((route) => route.trackId);
		return trackIds.length > 0 ? [{ ...stem, trackIds }] : [];
	});

	const directory = outputDir.replace(/[\\/]+$/, "");
	const usedNames = new Set<string>();
	const written: MixStem[] = [];
	for (const stem of stems) {
		const buffer = await renderBrowserTimelineAudio({
			tracks,
			mediaItems: useMediaStore.getState().mediaItems,
			totalDuration: timeline.getTotalDuration(),
			fps: project?.fps ?? 30,
			audioMix: project?.audioMix,
			stemBusId: stem.busId,
		});
		if (!buffer) continue;
		let fileName = safeFileName(stem.name);
		if (usedNames.has(fileName.toLowerCase())) {
			fileName = `${fileName}-${safeFileName(stem.busId)}`;
		}
		usedNames.add(fileName.toLowerCase());
		const path = `${directory}/${fileNamePrefix}${fileName}.wav`;
		// Stems leave their bus before the master and its limiter, so a loud
		// bus can pass full scale; float keeps those samples instead of clipping.
		const saved = await platform().files.writeFile(
			path,
			encodeAudioBufferAsWav({ buffer, format: "float32" })
		);
		if (!saved)
			throw new Error(`Could not write the ${stem.name} stem to ${path}`);
		written.push({ ...stem, path });
	}
	return written;
}
