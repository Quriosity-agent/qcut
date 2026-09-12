"use client";

import { useDragDrop } from "@/hooks/use-drag-drop";
import { useAsyncMediaStore } from "@/hooks/media/use-async-media-store";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MediaDragOverlay } from "@/components/editor/media-panel/drag-overlay";
import { useProjectStore } from "@/stores/project-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFolderStore } from "@/stores/folder-store";
import { FolderTree } from "../../folder-tree";
import { useMediaActions } from "./use-media-actions";
import { MediaItemCard } from "./media-item-card";
import { MediaFolderCard } from "./media-folder-card";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import {
	buildMediaLibraryEntries,
	getMediaUsageCounts,
	sortMediaLibraryItems,
	type MediaLibrarySort,
	type MediaLibrarySortDirection,
} from "./media-library-view";
import {
	MediaSelectionToolbar,
	MediaToolbar,
	type MediaLibraryFilter,
	type MediaLibraryViewMode,
} from "./media-toolbar";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Media library view with drag-and-drop upload, folder filtering, search, and context menu actions. */
export function MediaView() {
	const { t } = useTranslation();
	const {
		store: mediaStore,
		loading: mediaStoreLoading,
		error: mediaStoreError,
	} = useAsyncMediaStore();

	// Memoize to prevent infinite loops
	const mediaItems = useMemo(
		() => mediaStore?.mediaItems || [],
		[mediaStore?.mediaItems]
	);
	const addMediaItem = mediaStore?.addMediaItem;
	const removeMediaItem = mediaStore?.removeMediaItem;
	const addToFolder = mediaStore?.addToFolder;
	const removeFromFolder = mediaStore?.removeFromFolder;

	// Folder state
	const { folders, selectedFolderId, setSelectedFolder } = useFolderStore();
	const { activeProject } = useProjectStore();
	const tracks = useTimelineStore((state) => state.tracks);

	const [searchQuery, setSearchQuery] = useState("");
	const [mediaFilter, setMediaFilter] = useState<MediaLibraryFilter>("all");
	const [sortBy, setSortBy] = useState<MediaLibrarySort>("name");
	const [sortDirection, setSortDirection] =
		useState<MediaLibrarySortDirection>("asc");
	const [viewMode, setViewMode] = useState<MediaLibraryViewMode>("grid");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const mediaUsageCounts = useMemo(
		() => getMediaUsageCounts({ tracks }),
		[tracks]
	);

	const filteredMediaItems = useMemo(() => {
		const filtered = mediaItems.filter((item) => {
			if (item.ephemeral) return false;
			if (mediaFilter !== "all" && item.type !== mediaFilter) return false;
			if (
				searchQuery &&
				!item.name.toLowerCase().includes(searchQuery.toLowerCase())
			)
				return false;
			if (selectedFolderId !== null) {
				if (!(item.folderIds || []).includes(selectedFolderId)) return false;
			}
			return true;
		});
		return sortMediaLibraryItems({
			items: filtered,
			sortBy,
			direction: sortDirection,
		});
	}, [
		mediaItems,
		mediaFilter,
		searchQuery,
		selectedFolderId,
		sortBy,
		sortDirection,
	]);

	// Clear selection when filters change
	// biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedIds is a stable state setter
	useEffect(() => {
		setSelectedIds(new Set());
	}, [mediaFilter, searchQuery, selectedFolderId]);

	const {
		fileInputRef,
		isProcessing,
		progress,
		isSyncing,
		processFiles,
		handleFileSelect,
		handleSync,
		triggerAutoSync,
		toggleSelect,
		clearSelection,
		handleAddSelectedToTimeline,
		handleDeleteSelected,
		handleDownloadSelected,
		handleFileChange,
		handleRemove,
		handleEdit,
	} = useMediaActions({
		mediaItems,
		filteredMediaItems,
		activeProjectId: activeProject?.id,
		addMediaItem,
		removeMediaItem,
		mediaStoreHasInitialized: mediaStore?.hasInitialized,
		selectedIds,
		setSelectedIds,
	});

	const { isDragOver, dragProps } = useDragDrop({
		onDrop: processFiles,
	});

	// Auto-sync on first mount when media store is initialized
	useEffect(() => {
		triggerAutoSync();
	}, [triggerAutoSync]);

	// Folders show up among the tiles like a file browser: the children of the
	// current folder (or the root), narrowed by the search box like media is.
	const entries = useMemo(() => {
		const query = searchQuery.toLowerCase();
		const childFolders = folders.filter(
			(folder) =>
				folder.parentId === selectedFolderId &&
				(!query || folder.name.toLowerCase().includes(query))
		);
		return buildMediaLibraryEntries({
			folders: childFolders,
			items: filteredMediaItems,
			sortBy,
			direction: sortDirection,
		});
	}, [
		folders,
		selectedFolderId,
		searchQuery,
		filteredMediaItems,
		sortBy,
		sortDirection,
	]);

	// The heading over the grid names the current scope, like the source
	// groups in the sidebar: the whole library or the selected folder, with a
	// way back up once inside a folder.
	const selectedFolder =
		selectedFolderId === null
			? null
			: (folders.find((folder) => folder.id === selectedFolderId) ?? null);
	const scopeLabel = selectedFolder?.name ?? t("common.all");

	// Handle media store loading/error states
	if (mediaStoreError) {
		return (
			<div className="flex items-center justify-center h-full p-4">
				<div className="text-center">
					<div className="text-red-500 mb-2">{t("media.loadFailed")}</div>
					<div className="text-sm text-muted-foreground">
						{mediaStoreError.message}
					</div>
				</div>
			</div>
		);
	}

	if (mediaStoreLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="flex items-center space-x-2">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>{t("media.loading")}</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full">
			{/* Source sidebar */}
			<div className="w-36 min-w-[120px] max-w-[180px] flex-shrink-0">
				<FolderTree />
			</div>

			{/* Main media content */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Hidden file input for uploading media */}
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*,video/*,audio/*"
					multiple
					className="hidden"
					onChange={handleFileChange}
					aria-label={t("media.uploadFiles")}
				/>

				<div
					className={cn(
						"relative flex h-full flex-col transition-colors",
						isDragOver && "bg-accent/30"
					)}
					{...dragProps}
				>
					<div className="bg-panel px-3 pb-2 pt-3">
						{selectedIds.size > 0 ? (
							<MediaSelectionToolbar
								selectedCount={selectedIds.size}
								totalCount={filteredMediaItems.length}
								onSelectAll={() =>
									setSelectedIds(new Set(filteredMediaItems.map((m) => m.id)))
								}
								onAddToTimeline={handleAddSelectedToTimeline}
								onDownload={handleDownloadSelected}
								onDelete={handleDeleteSelected}
								onClear={clearSelection}
							/>
						) : (
							<MediaToolbar
								isProcessing={isProcessing}
								isSyncing={isSyncing}
								onImport={handleFileSelect}
								onSync={handleSync}
								searchQuery={searchQuery}
								onSearchChange={setSearchQuery}
								viewMode={viewMode}
								onViewModeChange={setViewMode}
								sortBy={sortBy}
								sortDirection={sortDirection}
								onSortByChange={setSortBy}
								onSortDirectionChange={setSortDirection}
								mediaFilter={mediaFilter}
								onMediaFilterChange={setMediaFilter}
							/>
						)}
					</div>

					<div
						className="flex items-center gap-1 px-3 pb-2 text-xs font-medium text-foreground/80"
						data-testid="media-scope-label"
					>
						{selectedFolder ? (
							<button
								type="button"
								className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
								onClick={() => setSelectedFolder(selectedFolder.parentId)}
								aria-label={t("media.backToParent")}
								title={t("media.backToParent")}
								data-testid="media-scope-back"
							>
								<ChevronLeft className="size-3.5" />
							</button>
						) : null}
						<span className="truncate">{scopeLabel}</span>
					</div>

					<ScrollArea className="h-full">
						<div className="flex-1 px-3 pb-3">
							{isDragOver || entries.length === 0 ? (
								<MediaDragOverlay
									isVisible={true}
									isProcessing={isProcessing}
									progress={progress}
									onClick={handleFileSelect}
									isEmptyState={entries.length === 0 && !isDragOver}
								/>
							) : (
								<div
									className={
										viewMode === "grid"
											? "grid gap-x-2.5 gap-y-3"
											: "flex flex-col gap-3"
									}
									style={
										viewMode === "grid"
											? {
													gridTemplateColumns:
														"repeat(auto-fill, minmax(112px, 1fr))",
												}
											: undefined
									}
									data-testid="media-library-items"
									data-view-mode={viewMode}
								>
									{entries.map((entry) =>
										entry.kind === "folder" ? (
											<MediaFolderCard
												key={`folder-${entry.folder.id}`}
												folder={entry.folder}
												viewMode={viewMode}
												onOpen={setSelectedFolder}
											/>
										) : (
											<MediaItemCard
												key={entry.item.id}
												item={entry.item}
												isSelected={selectedIds.has(entry.item.id)}
												filteredMediaItems={filteredMediaItems}
												folders={folders}
												addToFolder={addToFolder}
												removeFromFolder={removeFromFolder}
												onToggleSelect={toggleSelect}
												onEdit={handleEdit}
												onRemove={handleRemove}
												viewMode={viewMode}
												usageCount={mediaUsageCounts.get(entry.item.id) ?? 0}
											/>
										)
									)}
								</div>
							)}
						</div>
					</ScrollArea>
				</div>
			</div>
		</div>
	);
}
