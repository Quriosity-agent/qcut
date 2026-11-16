/**
 * How a media file's id and a free file name are made in a project's media
 * folder. A media id follows its file name, so a file renamed on disk has a
 * new id.
 *
 * @module electron/claude/handlers/claude-media-names
 */
import * as fs from "fs/promises";
import * as path from "path";

export function createMediaId({ fileName }: { fileName: string }): string {
	return `media_${Buffer.from(fileName).toString("base64url")}`;
}

/**
 * Generate a unique filename if file already exists
 * Appends numeric suffix: file.mp4 -> file_1.mp4 -> file_2.mp4
 */
export async function getUniqueFilePath(
	dir: string,
	fileName: string
): Promise<string> {
	const ext = path.extname(fileName);
	const baseName = path.basename(fileName, ext);
	let destPath = path.join(dir, fileName);
	let counter = 1;

	while (true) {
		try {
			await fs.access(destPath);
			// File exists, try next suffix
			destPath = path.join(dir, `${baseName}_${counter}${ext}`);
			counter++;
		} catch {
			// File doesn't exist, use this path
			return destPath;
		}
	}
}
