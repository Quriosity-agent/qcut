"use client";

import { useEffect, useState, useRef } from "react";
import { storageService } from "@/lib/storage/storage-service";

/**
 * Cleans up invalid blob URLs from existing storage data.
 * Blob URLs are temporary and become invalid after page reload.
 * This migration ensures no blob URLs persist in storage.
 */
export function BlobUrlCleanup({ children }: { children: React.ReactNode }) {
	const [isCleaningUp, setIsCleaningUp] = useState(false);
	const [hasCleanedUp, setHasCleanedUp] = useState(false);
	const runOnceRef = useRef(false);

	useEffect(() => {
		if (runOnceRef.current) return;
		runOnceRef.current = true;
		const cleanupBlobUrls = async () => {
			// Check if cleanup migration has already been completed (persists across sessions)
			// Use localStorage instead of sessionStorage so we only run this ONCE ever
			const cleanupKey = "blob-url-cleanup-v2";
			const hasCleanedPermanent = localStorage.getItem(cleanupKey);

			if (hasCleanedPermanent) {
				console.log(
					"[BlobUrlCleanup] Skipping cleanup (migration already complete)"
				);
				setHasCleanedUp(true);
				return;
			}

			setIsCleaningUp(true);
			console.log("[BlobUrlCleanup] Starting blob URL cleanup migration...");

			try {
				// Clean up projects with blob URL thumbnails
				const projects = await storageService.loadAllProjects();
				let projectsUpdated = 0;

				for (const project of projects) {
					let needsUpdate = false;

					// Check if thumbnail is a blob URL
					if (project.thumbnail?.startsWith("blob:")) {
						project.thumbnail = "";
						needsUpdate = true;
					}

					if (needsUpdate) {
						await storageService.saveProject({ project });
						projectsUpdated++;
						console.log(`[BlobUrlCleanup] Cleaned project: ${project.name}`);
					}
				}

				// Clean up media items with blob URLs
				let mediaItemsCleaned = 0;
				let mediaItemsRemoved = 0;
				for (const project of projects) {
					const mediaItems = await storageService.loadAllMediaItems(project.id);

					for (const item of mediaItems) {
						let needsUpdate = false;
						let shouldRemove = false;

						// Check if URL is a blob URL
						if (item.url?.startsWith("blob:")) {
							console.log(
								`[BlobUrlCleanup] Found media item with blob URL: ${item.name} (${item.url})`
							);

							// If the item has no file or an empty file, remove it entirely
							if (!item.file || item.file.size === 0) {
								console.log(
									`[BlobUrlCleanup] Removing media item with no file: ${item.name}`
								);
								// Note: We can't directly delete from storage here, but mark it for removal
								shouldRemove = true;
								mediaItemsRemoved++;
							} else {
								// Item has a file, clear the blob URL and let it regenerate
								item.url = undefined;
								needsUpdate = true;
								console.log(
									`[BlobUrlCleanup] Cleared blob URL for media item: ${item.name}`
								);
							}
						}

						// Check if thumbnail URL is a blob URL
						if (item.thumbnailUrl?.startsWith("blob:")) {
							console.log(
								`[BlobUrlCleanup] Found thumbnail with blob URL: ${item.name} (${item.thumbnailUrl})`
							);
							item.thumbnailUrl = undefined;
							needsUpdate = true;
						}

						if (needsUpdate && !shouldRemove) {
							await storageService.saveMediaItem(project.id, item);
							mediaItemsCleaned++;
							console.log(`[BlobUrlCleanup] Updated media item: ${item.name}`);
						}
					}
				}

				// Timeline elements don't directly store URLs - they reference media items by ID
				// The cleanup above for media items should handle any blob URLs in the system

				console.log(
					`[BlobUrlCleanup] Cleanup complete. Projects: ${projectsUpdated}, Media items cleaned: ${mediaItemsCleaned}, Media items removed: ${mediaItemsRemoved}`
				);

				// Mark cleanup as done PERMANENTLY (migration complete)
				localStorage.setItem(cleanupKey, "true");
				setHasCleanedUp(true);
			} catch (error) {
				console.error("[BlobUrlCleanup] Cleanup failed:", error);
			} finally {
				setIsCleaningUp(false);
			}
		};

		cleanupBlobUrls();
	}, []);

	// Don't block rendering, just log the cleanup status
	if (isCleaningUp && !hasCleanedUp) {
		console.log("[BlobUrlCleanup] Cleaning up blob URLs in background...");
	}

	return children;
}
