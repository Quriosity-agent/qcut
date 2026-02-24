/**
 * Auto-import logic for AI Pipeline output.
 * @module electron/ai-pipeline-handler/auto-import
 */

import { importMediaFile } from "../claude/handlers/claude-media-handler.js";
import { inferProjectIdFromPath } from "../ai-pipeline-output.js";
import type { GenerateOptions, PipelineResult } from "./types.js";

/** Auto-import generated output files into the QCut project if enabled. */
export async function maybeAutoImportOutput({
	options,
	result,
}: {
	options: GenerateOptions;
	result: PipelineResult;
}): Promise<PipelineResult> {
	try {
		if (!result.success || !result.outputPath) {
			return result;
		}

		if (options.autoImport === false) {
			return result;
		}

		const projectId =
			options.projectId ||
			inferProjectIdFromPath({ filePath: result.outputPath });
		if (!projectId) {
			return result;
		}

		const importedMedia = await importMediaFile(projectId, result.outputPath);
		if (importedMedia) {
			return {
				...result,
				mediaId: importedMedia.id,
				importedPath: importedMedia.path,
			};
		}

		return {
			...result,
			success: false,
			errorCode: "import_failed",
			error:
				"Generation succeeded but import failed. Try importing the output file manually from the generated path.",
		};
	} catch (error) {
		console.error(
			"[AI Pipeline] Failed to auto-import generated media:",
			error
		);
		return {
			...result,
			success: false,
			errorCode: "import_failed",
			error:
				"Generation succeeded but media import failed due to an unexpected error.",
		};
	}
}
