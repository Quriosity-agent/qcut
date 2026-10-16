import { platform } from "@qcut/platform-core";
import { storageService } from "@/lib/storage/storage-service";
import { debugError, debugLog } from "@/lib/debug/debug-config";
import type { TProject } from "@/types/project";

/**
 * Duplicating a project copies everything the editor stores per project:
 * media metadata and bytes, media folders, every scene's timeline (with its
 * transitions and track mixer settings), overlay stickers, and the project
 * folder on disk. The project record itself is copied by the project store.
 */

const COPY_SUFFIX = "（副本）";

/** "原名（副本）", then "原名（副本 2）" and so on when that name is taken. */
export function duplicateProjectName({
	name,
	existingNames,
}: {
	name: string;
	existingNames: readonly string[];
}): string {
	const base = name.replace(/（副本(?: \d+)?）$/u, "");
	const taken = new Set(existingNames);
	const first = `${base}${COPY_SUFFIX}`;
	if (!taken.has(first)) return first;
	for (let index = 2; ; index += 1) {
		const candidate = `${base}（副本 ${index}）`;
		if (!taken.has(candidate)) return candidate;
	}
}

export interface ProjectContentsCopy {
	mediaItems: number;
	timelines: number;
	folders: number;
	stickers: number;
	/** The disk folder was copied too (desktop only). */
	diskCopied: boolean;
}

/**
 * Copies the source project's stored contents under the target id. Media ids
 * stay the same so the copied timeline keeps pointing at the right items;
 * stored file paths move from the source folder to the target folder when
 * the desktop copied the folder.
 */
export async function copyProjectContents({
	source,
	targetProjectId,
}: {
	source: TProject;
	targetProjectId: string;
}): Promise<ProjectContentsCopy> {
	const disk = await copyProjectFolder({
		sourceProjectId: source.id,
		targetProjectId,
	});
	const rewriteLocalPath = (localPath: string): string =>
		disk && localPath.startsWith(`${disk.sourceRoot}/`)
			? `${disk.targetRoot}/${localPath.slice(disk.sourceRoot.length + 1)}`
			: localPath;
	const mediaItems = await storageService.copyProjectMedia({
		sourceProjectId: source.id,
		targetProjectId,
		rewriteLocalPath,
	});

	const folders = await storageService.loadFolders(source.id);
	if (folders.length > 0) {
		await storageService.saveFolders(targetProjectId, folders);
	}

	let timelines = 0;
	const sceneIds: Array<string | undefined> = [
		undefined,
		...source.scenes.map((scene) => scene.id),
	];
	for (const sceneId of sceneIds) {
		const tracks = await storageService.loadTimeline({
			projectId: source.id,
			sceneId,
		});
		if (!tracks) continue;
		await storageService.saveTimeline({
			projectId: targetProjectId,
			tracks: structuredClone(tracks),
			sceneId,
		});
		timelines += 1;
	}

	let stickers = 0;
	try {
		const stored = await platform().storage.load(
			`overlay-stickers-${source.id}`
		);
		if (Array.isArray(stored) && stored.length > 0) {
			await platform().storage.save(
				`overlay-stickers-${targetProjectId}`,
				stored
			);
			stickers = stored.length;
		}
	} catch (error) {
		debugError("[ProjectDuplicate] overlay stickers not copied:", error);
	}

	debugLog("[ProjectDuplicate] copied project contents", {
		source: source.id,
		target: targetProjectId,
		mediaItems,
		timelines,
		folders: folders.length,
		stickers,
		diskCopied: disk !== null,
	});
	return {
		mediaItems,
		timelines,
		folders: folders.length,
		stickers,
		diskCopied: disk !== null,
	};
}

/** Copies the project folder on disk through the desktop bridge, if there is one. */
async function copyProjectFolder({
	sourceProjectId,
	targetProjectId,
}: {
	sourceProjectId: string;
	targetProjectId: string;
}): Promise<{ sourceRoot: string; targetRoot: string } | null> {
	const copy =
		typeof window !== "undefined"
			? window.electronAPI?.projectFolder?.copyContents
			: undefined;
	if (!copy) return null;
	try {
		const result = await copy(sourceProjectId, targetProjectId);
		return { sourceRoot: result.sourceRoot, targetRoot: result.targetRoot };
	} catch (error) {
		debugError("[ProjectDuplicate] project folder not copied:", error);
		return null;
	}
}
