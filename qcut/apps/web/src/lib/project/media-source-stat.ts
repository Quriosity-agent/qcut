/**
 * What a media item records of the file its bytes were copied from.
 *
 * The record tells whether the file under the item's name is still that
 * file (media-source-refresh.ts reads a changed one again), and whose an
 * item is when two files could be meant by it (a rename that is not
 * settled, stores/media/media-rename.ts).
 *
 * @module lib/project/media-source-stat
 */
import type { MediaItem } from "@/stores/media/media-store-types";

/** The file an item's bytes were copied from, as it was then. */
export interface SourceFileStat {
	size: number;
	/** Milliseconds, as the file system reports it. */
	modifiedAt: number;
}

/** File systems keep times to different precisions; under this is the same. */
const SAME_TIME_MS = 2;

/** The record on an item, or undefined when it has none that can be used. */
export function readSourceFileStat({
	item,
}: {
	item: Pick<MediaItem, "metadata">;
}): SourceFileStat | undefined {
	const recorded = item.metadata?.sourceFile as
		| Partial<SourceFileStat>
		| undefined;
	if (
		!recorded ||
		typeof recorded.size !== "number" ||
		typeof recorded.modifiedAt !== "number" ||
		!Number.isFinite(recorded.size) ||
		!Number.isFinite(recorded.modifiedAt)
	) {
		return;
	}
	return { size: recorded.size, modifiedAt: recorded.modifiedAt };
}

/** Whether two records are of one file as it was at one time. */
export function sameSourceFile(
	left: SourceFileStat,
	right: SourceFileStat
): boolean {
	return (
		left.size === right.size &&
		Math.abs(left.modifiedAt - right.modifiedAt) <= SAME_TIME_MS
	);
}
