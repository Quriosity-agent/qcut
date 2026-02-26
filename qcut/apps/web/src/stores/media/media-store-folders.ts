/**
 * Media Store Folder Operations
 *
 * Zustand slice for folder assignment, bulk folder operations,
 * and auto-organization by media type.
 *
 * @module stores/media/media-store-folders
 */

import { debugLog, debugError } from "@/lib/debug/debug-config";
import { storageService } from "@/lib/storage/storage-service";
import type { MediaItem } from "./media-store-types";
import { DEFAULT_FOLDER_IDS } from "./media-store-types";

interface FolderSliceState {
	mediaItems: MediaItem[];
}

type SetState = (
	updater:
		| Partial<FolderSliceState>
		| ((state: FolderSliceState) => Partial<FolderSliceState>)
) => void;
type GetState = () => FolderSliceState;

export interface FolderActions {
	addToFolder: (mediaId: string, folderId: string) => void;
	removeFromFolder: (mediaId: string, folderId: string) => void;
	moveToFolder: (mediaId: string, targetFolderId: string | null) => void;
	getMediaByFolder: (folderId: string | null) => MediaItem[];
	bulkAddToFolder: (mediaIds: string[], folderId: string) => void;
	bulkMoveToFolder: (mediaIds: string[], folderId: string | null) => void;
	autoOrganizeByType: () => void;
}

/** Persist a media item to storage using the active project ID. */
function persistMediaItem(item: MediaItem): void {
	import("@/stores/project-store")
		.then(({ useProjectStore }) => {
			const projectId = useProjectStore.getState().activeProject?.id;
			if (projectId) {
				storageService.saveMediaItem(projectId, item).catch((error) => {
					debugError("[MediaStore] Failed to persist folder change:", error);
				});
			}
		})
		.catch((error) => {
			debugError("[MediaStore] Failed to import project-store:", error);
		});
}

/** Persist multiple media items to storage. */
function persistMediaItems(items: MediaItem[]): void {
	import("@/stores/project-store")
		.then(({ useProjectStore }) => {
			const projectId = useProjectStore.getState().activeProject?.id;
			if (projectId) {
				for (const item of items) {
					storageService.saveMediaItem(projectId, item).catch((error) => {
						debugError("[MediaStore] Failed to persist folder change:", error);
					});
				}
			}
		})
		.catch((error) => {
			debugError("[MediaStore] Failed to import project-store:", error);
		});
}

/** Create folder-related store actions as a zustand slice. */
export function createFolderActions(
	set: SetState,
	get: GetState
): FolderActions {
	return {
		addToFolder: (mediaId, folderId) => {
			set((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					item.id === mediaId
						? {
								...item,
								folderIds: [...(item.folderIds || []), folderId].filter(
									(id, index, arr) => arr.indexOf(id) === index // dedupe
								),
							}
						: item
				),
			}));
			debugLog("[MediaStore] Added media to folder:", { mediaId, folderId });

			const { mediaItems } = get();
			const item = mediaItems.find((m) => m.id === mediaId);
			if (item) persistMediaItem(item);
		},

		removeFromFolder: (mediaId, folderId) => {
			set((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					item.id === mediaId
						? {
								...item,
								folderIds: (item.folderIds || []).filter(
									(id) => id !== folderId
								),
							}
						: item
				),
			}));
			debugLog("[MediaStore] Removed media from folder:", {
				mediaId,
				folderId,
			});

			const { mediaItems } = get();
			const item = mediaItems.find((m) => m.id === mediaId);
			if (item) persistMediaItem(item);
		},

		moveToFolder: (mediaId, targetFolderId) => {
			set((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					item.id === mediaId
						? {
								...item,
								folderIds: targetFolderId ? [targetFolderId] : [],
							}
						: item
				),
			}));
			debugLog("[MediaStore] Moved media to folder:", {
				mediaId,
				targetFolderId,
			});

			const { mediaItems } = get();
			const item = mediaItems.find((m) => m.id === mediaId);
			if (item) persistMediaItem(item);
		},

		getMediaByFolder: (folderId) => {
			const { mediaItems } = get();
			if (folderId === null) {
				// "All Media" - return everything (excluding ephemeral)
				return mediaItems.filter((item) => !item.ephemeral);
			}
			return mediaItems.filter(
				(item) => !item.ephemeral && (item.folderIds || []).includes(folderId)
			);
		},

		bulkAddToFolder: (mediaIds, folderId) => {
			set((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					mediaIds.includes(item.id)
						? {
								...item,
								folderIds: [...new Set([...(item.folderIds || []), folderId])],
							}
						: item
				),
			}));
			debugLog("[MediaStore] Bulk added to folder:", {
				count: mediaIds.length,
				folderId,
			});

			const { mediaItems } = get();
			const changedItems = mediaItems.filter((m) => mediaIds.includes(m.id));
			persistMediaItems(changedItems);
		},

		bulkMoveToFolder: (mediaIds, folderId) => {
			set((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					mediaIds.includes(item.id)
						? {
								...item,
								folderIds: folderId ? [folderId] : [],
							}
						: item
				),
			}));
			debugLog("[MediaStore] Bulk moved to folder:", {
				count: mediaIds.length,
				folderId,
			});

			const { mediaItems } = get();
			const changedItems = mediaItems.filter((m) => mediaIds.includes(m.id));
			persistMediaItems(changedItems);
		},

		autoOrganizeByType: () => {
			const { mediaItems } = get();

			const typeToFolder: Record<string, string> = {
				video: DEFAULT_FOLDER_IDS.VIDEOS,
				audio: DEFAULT_FOLDER_IDS.AUDIO,
				image: DEFAULT_FOLDER_IDS.IMAGES,
			};

			let organizedCount = 0;
			const updatedItems = mediaItems.map((item) => {
				// Skip if already organized or ephemeral
				if (item.ephemeral || (item.folderIds && item.folderIds.length > 0)) {
					return item;
				}

				// AI-generated content goes to AI Generated folder
				// Check for explicit AI sources (not uploads or other non-AI sources)
				const source = item.metadata?.source;
				const isAiGenerated =
					source &&
					(source.includes("ai") ||
						source === "text2image" ||
						source === "fal-ai" ||
						source.startsWith("fal-"));
				if (isAiGenerated) {
					organizedCount++;
					return { ...item, folderIds: [DEFAULT_FOLDER_IDS.AI_GENERATED] };
				}

				// Organize by media type
				const targetFolder = typeToFolder[item.type];
				if (targetFolder) {
					organizedCount++;
					return { ...item, folderIds: [targetFolder] };
				}

				return item;
			});

			set({ mediaItems: updatedItems });
			debugLog("[MediaStore] Auto-organized media by type:", {
				organizedCount,
			});

			// Persist all newly organized items
			const changedItems = updatedItems.filter(
				(item) =>
					!item.ephemeral &&
					item.folderIds &&
					item.folderIds.length > 0 &&
					!mediaItems.find(
						(orig) =>
							orig.id === item.id && orig.folderIds && orig.folderIds.length > 0
					)
			);
			persistMediaItems(changedItems);
		},
	};
}
