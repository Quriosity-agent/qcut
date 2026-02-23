/**
 * Shared output directory utilities
 *
 * Resolves output directories without Electron dependency.
 * Uses os.tmpdir() as fallback instead of app.getPath("temp").
 *
 * @module electron/native-pipeline/output-utils
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export function resolveOutputDir(
	outputDir: string | undefined,
	sessionId: string,
	tempBase?: string
): string {
	if (outputDir) {
		fs.mkdirSync(outputDir, { recursive: true });
		return outputDir;
	}
	const base = tempBase || os.tmpdir();
	const dir = path.join(base, "qcut", "aicp-output", sessionId);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}
