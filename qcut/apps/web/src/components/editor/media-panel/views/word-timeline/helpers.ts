import {
	WORD_FILTER_STATE,
	type WordFilterState,
	type WordItem,
} from "@/types/word-timeline";

/** Supported media extensions for transcription */
export const MEDIA_EXTENSIONS = [
	".mp4",
	".mov",
	".avi",
	".mkv",
	".webm",
	".wav",
	".mp3",
	".m4a",
	".aac",
];

/** Check if a file is a supported media file */
export function isMediaFile(fileName: string): boolean {
	const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
	return MEDIA_EXTENSIONS.includes(ext);
}

/** Check if a file is a JSON file */
export function isJsonFile(fileName: string): boolean {
	return fileName.toLowerCase().endsWith(".json");
}

/** Format seconds to MM:SS.ms format */
export function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
}

/** Format duration in human readable form */
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Return Tailwind classes for a word chip based on its filter state. */
export function getChipColor({
	filterState,
}: {
	filterState: WordFilterState;
}): string {
	if (filterState === WORD_FILTER_STATE.AI) {
		return "bg-orange-500/20 text-orange-700 border border-dashed border-orange-400";
	}
	if (filterState === WORD_FILTER_STATE.USER_REMOVE) {
		return "bg-destructive/20 text-destructive line-through decoration-2";
	}
	if (filterState === WORD_FILTER_STATE.USER_KEEP) {
		return "bg-emerald-500/20 text-emerald-700 border border-emerald-400";
	}
	return "bg-muted hover:bg-accent hover:text-accent-foreground";
}

/** Return contextual tooltip text based on a word's current filter state. */
export function getChipHelpText({ word }: { word: WordItem }): string {
	if (word.filterState === WORD_FILTER_STATE.AI) {
		return "Left-click keep, right-click remove";
	}
	if (word.filterState === WORD_FILTER_STATE.USER_REMOVE) {
		return "Left-click keep, right-click keep removed";
	}
	if (word.filterState === WORD_FILTER_STATE.USER_KEEP) {
		return "Left-click remove, right-click remove";
	}
	return "Left-click seek, right-click remove";
}

/** Sum the duration of all words marked for removal (AI or user-removed). */
export function calculateRemovedDuration({
	words,
}: {
	words: WordItem[];
}): number {
	try {
		const ranges = words
			.filter(
				(word) =>
					word.filterState === WORD_FILTER_STATE.AI ||
					word.filterState === WORD_FILTER_STATE.USER_REMOVE
			)
			.map((word) => ({
				start: Math.max(0, word.start),
				end: Math.max(word.start, word.end),
			}))
			.sort((left, right) => left.start - right.start);

		if (ranges.length === 0) {
			return 0;
		}

		const merged: Array<{ start: number; end: number }> = [];
		for (const range of ranges) {
			const previous = merged[merged.length - 1];
			if (!previous || range.start > previous.end) {
				merged.push({ ...range });
				continue;
			}
			previous.end = Math.max(previous.end, range.end);
		}

		let total = 0;
		for (const range of merged) {
			total += Math.max(0, range.end - range.start);
		}
		return total;
	} catch {
		return 0;
	}
}
