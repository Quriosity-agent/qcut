import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";

/**
 * Moves a file: a rename on the same device, and a copy followed by a
 * delete across devices. An export written to another disk cannot be
 * renamed into the system temp directory (EXDEV), which used to fail the
 * export and leave the unmixed video behind.
 *
 * A copy that fails midway (a full disk, say) removes its partial `to` and
 * rethrows, leaving `from` intact. Should deleting `from` fail after a
 * complete copy, the move reports that failure although `to` is whole.
 */
export async function moveFile({
	from,
	to,
}: {
	from: string;
	to: string;
}): Promise<void> {
	try {
		await fsPromises.rename(from, to);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		try {
			await fsPromises.copyFile(from, to);
		} catch (copyError) {
			await fsPromises.rm(to, { force: true }).catch(() => undefined);
			throw copyError;
		}
		await fsPromises.unlink(from);
	}
}

/** The synchronous form of {@link moveFile}, for the export paths that run synchronously. */
export function moveFileSync({ from, to }: { from: string; to: string }): void {
	try {
		fs.renameSync(from, to);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		try {
			fs.copyFileSync(from, to);
		} catch (copyError) {
			try {
				fs.rmSync(to, { force: true });
			} catch {
				// The partial copy could not be removed; the copy error is reported.
			}
			throw copyError;
		}
		fs.unlinkSync(from);
	}
}
