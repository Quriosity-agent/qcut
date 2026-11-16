/**
 * The editor's side of `PATCH /api/claude/media/:projectId/:mediaId/rename`.
 *
 * The desktop app renames the file in the project folder, then asks here for
 * the editor's item and its clips to follow. The answer is the
 * acknowledgement: a rename the editor refuses is undone on disk.
 *
 * @module lib/claude-bridge/claude-media-rename-bridge
 */
import type { PlatformClaudeMediaAPI } from "@qcut/platform-core";
import { debugLog, debugWarn } from "@/lib/debug/debug-config";
import {
	type ProjectMediaRename,
	renameProjectMedia,
} from "@/stores/media/media-rename";
import { useProjectStore } from "@/stores/project-store";

function readText({ value }: { value: unknown }): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

/** The rename the desktop app reports, or null when it is not one. */
export function parseClaudeRenamedMediaEvent({
	candidate,
}: {
	candidate: unknown;
}): ProjectMediaRename | null {
	if (
		typeof candidate !== "object" ||
		candidate === null ||
		Array.isArray(candidate)
	) {
		return null;
	}
	const record = candidate as Record<string, unknown>;
	const projectId = readText({ value: record.projectId });
	const fromId = readText({ value: record.mediaId });
	const toId = readText({ value: record.newMediaId });
	const name = readText({ value: record.newName });
	const localPath = readText({ value: record.newPath });
	if (!projectId || !fromId || !toId || !name || !localPath) return null;
	const deadlineAt =
		typeof record.deadlineAt === "number" && Number.isFinite(record.deadlineAt)
			? record.deadlineAt
			: undefined;
	return {
		projectId,
		fromId,
		toId,
		name,
		localPath,
		...(deadlineAt === undefined ? {} : { deadlineAt }),
	};
}

export function setupMediaRenameHandler({
	media,
}: {
	media?: PlatformClaudeMediaAPI;
}): void {
	if (!media?.onMediaRenamed) return;
	media.onMediaRenamed(async (candidate: unknown) => {
		const rename = parseClaudeRenamedMediaEvent({ candidate });
		if (!rename) throw new Error("Invalid media rename event");
		const activeProjectId = useProjectStore.getState().activeProject?.id;
		if (activeProjectId !== rename.projectId) {
			throw new Error(
				`Cannot rename media for inactive project ${rename.projectId}`
			);
		}
		try {
			const result = await renameProjectMedia(rename);
			debugLog("[ClaudeMediaRename] Renamed media:", rename.name, result);
		} catch (error) {
			debugWarn("[ClaudeMediaRename] Failed to follow a media rename:", error);
			throw error instanceof Error ? error : new Error(String(error));
		}
	});
}
