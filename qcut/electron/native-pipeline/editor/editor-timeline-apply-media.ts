/**
 * The media step of `editor timeline apply`: files the project already has
 * are reused, the rest are imported, and every alias gets its media id.
 *
 * @module electron/native-pipeline/editor/editor-timeline-apply-media
 */
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import type { EditorApiClient } from "./editor-api-client.js";
import { aliasFor, type ManifestMedia } from "./editor-timeline-manifest.js";

/** Files per import request: the editor takes at most this many at once. */
const MEDIA_IMPORT_BATCH = 20;

/** Each file may wait for the editor to load it (up to 20 s of its own). */
function mediaImportTimeoutMs({ count }: { count: number }): number {
	return 60_000 + 20_000 * count;
}

interface MediaFileSummary {
	id: string;
	name?: string;
	size?: number;
}

interface ImportResult {
	index: number;
	success: boolean;
	mediaFile?: MediaFileSummary;
	error?: string;
}

export async function importManifestMedia({
	client,
	projectId,
	media,
	mediaIds,
	newMediaIds,
}: {
	client: EditorApiClient;
	projectId: string;
	media: ManifestMedia[];
	mediaIds: Map<string, string>;
	newMediaIds: Set<string>;
}): Promise<void> {
	const existing = await client.get<MediaFileSummary[]>(
		`/api/claude/media/${encodeURIComponent(projectId)}`
	);
	const existingIds = new Set(existing.map((item) => item.id));
	const sourceSizes = await Promise.all(
		media.map(async (entry) => {
			if (!entry.path) return undefined;
			try {
				return (await fs.stat(entry.path)).size;
			} catch {
				return undefined;
			}
		})
	);
	const imports: Array<{ path?: string; url?: string; filename?: string }> = [];
	const importEntries: Array<{ entry: ManifestMedia; manifestIndex: number }> =
		[];

	for (const [index, entry] of media.entries()) {
		const alias = aliasFor(entry, `media-${index}`);
		const directId =
			entry.mediaId ?? (!entry.path && !entry.url ? entry.id : undefined);
		if (directId) {
			mediaIds.set(alias, directId);
			mediaIds.set(directId, directId);
			continue;
		}
		const expectedName =
			entry.filename ?? (entry.path ? basename(entry.path) : undefined);
		const sourceSize = sourceSizes[index];
		const reusable =
			expectedName && sourceSize !== undefined
				? existing.filter(
						(item) => item.name === expectedName && item.size === sourceSize
					)
				: [];
		if (reusable.length === 1) {
			const mediaId = reusable[0].id;
			mediaIds.set(alias, mediaId);
			mediaIds.set(mediaId, mediaId);
			if (entry.id) mediaIds.set(entry.id, mediaId);
			continue;
		}
		if (!entry.path && !entry.url) {
			throw new Error(`Media '${alias}' needs path, url, or mediaId`);
		}
		imports.push({
			path: entry.path,
			url: entry.url,
			filename: entry.filename,
		});
		importEntries.push({ entry, manifestIndex: index });
	}

	if (imports.length === 0) return;
	const results: ImportResult[] = [];
	for (let offset = 0; offset < imports.length; offset += MEDIA_IMPORT_BATCH) {
		const batch = imports.slice(offset, offset + MEDIA_IMPORT_BATCH);
		results.push(
			...(await client.post<ImportResult[]>(
				`/api/claude/media/${encodeURIComponent(projectId)}/batch-import`,
				{ items: batch },
				{ timeout: mediaImportTimeoutMs({ count: batch.length }) }
			))
		);
	}
	for (const [index, result] of results.entries()) {
		const { entry, manifestIndex } = importEntries[index];
		const alias = aliasFor(entry, `media-${manifestIndex}`);
		if (!result.success || !result.mediaFile) {
			throw new Error(
				`Media '${alias}' failed: ${result.error || "unknown error"}`
			);
		}
		const mediaId = result.mediaFile.id;
		mediaIds.set(alias, mediaId);
		mediaIds.set(mediaId, mediaId);
		if (entry.id) mediaIds.set(entry.id, mediaId);
		if (!existingIds.has(mediaId)) newMediaIds.add(mediaId);
	}
}
