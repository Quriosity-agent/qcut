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
import { platform } from "@qcut/platform-core";
import type { MediaItem } from "@/stores/media/media-store-types";

/** The file an item's bytes were copied from, as it was then. */
export interface SourceFileStat {
	size: number;
	/** Milliseconds, as the file system reports it. */
	modifiedAt: number;
	/**
	 * By when the editor held these bytes (epoch milliseconds): the moment
	 * they had been read, or, for a copy made before this was recorded, the
	 * moment the file was first found to be what it holds. The copy is at
	 * least this old. A file that got the item's name later than this is
	 * not what the item was copied from.
	 */
	heldSince?: number;
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
	return {
		size: recorded.size,
		modifiedAt: recorded.modifiedAt,
		...(typeof recorded.heldSince === "number" &&
		Number.isFinite(recorded.heldSince)
			? { heldSince: recorded.heldSince }
			: {}),
	};
}

/**
 * Whether two records are of one file as it was at one time, whenever the
 * editor came to hold a copy of it.
 */
export function sameSourceFile(
	left: SourceFileStat,
	right: SourceFileStat
): boolean {
	return (
		left.size === right.size &&
		Math.abs(left.modifiedAt - right.modifiedAt) <= SAME_TIME_MS
	);
}

/**
 * The file's size and time now. The desktop app answers with dates
 * (`lastModified`, `modified`), which is not what its declared type says, so
 * both shapes are read.
 */
export async function statSourceFile({
	filePath,
}: {
	filePath: string;
}): Promise<SourceFileStat> {
	const info = (await platform().files.getFileInfo(filePath)) as unknown as {
		size?: unknown;
		modifiedAt?: unknown;
		lastModified?: unknown;
		modified?: unknown;
	} | null;
	if (!info || typeof info.size !== "number") {
		throw new Error("the file is gone");
	}
	const when = info.modifiedAt ?? info.lastModified ?? info.modified;
	const modifiedAt =
		typeof when === "number" ? when : new Date(when as string | Date).getTime();
	if (!Number.isFinite(modifiedAt)) {
		throw new Error("the file's modification time could not be read");
	}
	return { size: info.size, modifiedAt };
}

/**
 * Reads a file's bytes and makes the record of what they were copied from:
 * the file as it was, and the moment the bytes had been read. There is no
 * record when the file cannot be looked at, or was not the same before and
 * after it was read (something is still writing it): the next check of the
 * folder then finds out whether the copy is the file.
 */
export async function readWithSourceRecord<
	Bytes extends { byteLength: number },
>({
	filePath,
	read,
}: {
	filePath: string;
	read: () => Promise<Bytes | null>;
}): Promise<{ bytes: Bytes | null; sourceFile?: SourceFileStat }> {
	const look = () => statSourceFile({ filePath }).catch(() => undefined);
	const before = await look();
	const bytes = await read();
	const heldSince = Date.now();
	if (!bytes || !before) return { bytes };
	const after = await look();
	const sameFile =
		after !== undefined &&
		bytes.byteLength === after.size &&
		sameSourceFile(before, after);
	return sameFile ? { bytes, sourceFile: { ...before, heldSince } } : { bytes };
}
