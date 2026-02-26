"use client";

import { useDragDrop } from "@/hooks/use-drag-drop";
import { useAsyncMediaStore } from "@/hooks/media/use-async-media-store";
import type { MediaItem } from "@/stores/media/media-store-types";
import {
	Loader2,
	Plus,
	RefreshCw,
	Download,
	Trash2,
	X,
	MoreHorizontal,
	ListPlus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MediaDragOverlay } from "@/components/editor/media-panel/drag-overlay";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useProjectStore } from "@/stores/project-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFolderStore } from "@/stores/folder-store";
import { FolderTree } from "../../folder-tree";
import { useMediaActions } from "./use-media-actions";
import { MediaItemCard } from "./media-item-card";

/** Media library view with drag-and-drop upload, folder filtering, search, and context menu actions. */
export function MediaView() {
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
	const { folders, selectedFolderId } = useFolderStore();
	const { activeProject } = useProjectStore();

	const [searchQuery, setSearchQuery] = useState("");
	const [mediaFilter, setMediaFilter] = useState("all");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const filteredMediaItems = useMemo(
		() =>
			mediaItems.filter((item) => {
				if (item.ephemeral) return false;
				if (mediaFilter && mediaFilter !== "all" && item.type !== mediaFilter)
					return false;
				if (
					searchQuery &&
					!item.name.toLowerCase().includes(searchQuery.toLowerCase())
				)
					return false;
				if (selectedFolderId !== null) {
					if (!(item.folderIds || []).includes(selectedFolderId)) return false;
				}
				return true;
			}),
		[mediaItems, mediaFilter, searchQuery, selectedFolderId]
	);

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

	// Handle media store loading/error states
	if (mediaStoreError) {
		return (
			<div className="flex items-center justify-center h-full p-4">
				<div className="text-center">
					<div className="text-red-500 mb-2">Failed to load media store</div>
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
					<span>Loading media library...</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full">
			{/* Folder sidebar */}
			<div className="w-44 min-w-[140px] max-w-[200px] flex-shrink-0">
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
					aria-label="Upload media files"
				/>

				<div
					className={`h-full flex flex-col gap-1 transition-colors relative ${isDragOver ? "bg-accent/30" : ""}`}
					{...dragProps}
				>
					<div className="p-3 pb-2 bg-panel">
						{selectedIds.size > 0 ? (
							/* Selection toolbar */
							<div className="flex items-center gap-2">
								<span className="text-xs font-medium whitespace-nowrap">
									{selectedIds.size} selected
								</span>
								{selectedIds.size < filteredMediaItems.length && (
									<button
										type="button"
										className="text-xs text-primary hover:text-primary/80 whitespace-nowrap"
										onClick={() =>
											setSelectedIds(
												new Set(filteredMediaItems.map((m) => m.id))
											)
										}
									>
										Select All
									</button>
								)}
								<div className="flex-1" />
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-8 text-xs"
									onClick={handleAddSelectedToTimeline}
								>
									<ListPlus className="h-3.5 w-3.5 mr-1" />
									Add to Timeline
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-8 text-xs"
									onClick={handleDownloadSelected}
								>
									<Download className="h-3.5 w-3.5 mr-1" />
									Download
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-8 text-xs text-destructive hover:text-destructive"
									onClick={handleDeleteSelected}
								>
									<Trash2 className="h-3.5 w-3.5 mr-1" />
									Delete
								</Button>
								<Button
									type="button"
									variant="text"
									size="sm"
									className="h-8 text-xs"
									onClick={clearSelection}
								>
									<X className="h-3.5 w-3.5 mr-1" />
									Deselect
								</Button>
							</div>
						) : (
							/* Default toolbar */
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleFileSelect}
									disabled={isProcessing}
									className="h-8 text-xs"
									data-testid="import-media-button"
									aria-label={isProcessing ? "Importing media" : "Import media"}
								>
									{isProcessing ? (
										<Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
									) : (
										<Plus className="h-3.5 w-3.5 mr-1" />
									)}
									Import
								</Button>
								<Input
									type="text"
									placeholder="Search media..."
									className="min-w-[60px] flex-1 h-8 text-xs"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
								/>
								<Select value={mediaFilter} onValueChange={setMediaFilter}>
									<SelectTrigger className="w-[80px] h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All</SelectItem>
										<SelectItem value="video">Video</SelectItem>
										<SelectItem value="audio">Audio</SelectItem>
										<SelectItem value="image">Image</SelectItem>
									</SelectContent>
								</Select>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="text"
											size="sm"
											className="h-8 w-8 p-0"
											aria-label="More actions"
										>
											<MoreHorizontal className="h-4 w-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											onClick={handleSync}
											disabled={isSyncing || isProcessing}
										>
											<RefreshCw
												className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`}
											/>
											Sync Project Folder
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						)}
					</div>

					<ScrollArea className="h-full">
						<div className="flex-1 p-3 pt-0">
							{isDragOver || filteredMediaItems.length === 0 ? (
								<MediaDragOverlay
									isVisible={true}
									isProcessing={isProcessing}
									progress={progress}
									onClick={handleFileSelect}
									isEmptyState={filteredMediaItems.length === 0 && !isDragOver}
								/>
							) : (
								<div
									className="grid gap-2"
									style={{
										gridTemplateColumns: "repeat(auto-fill, 160px)",
									}}
								>
									{filteredMediaItems.map((item) => (
										<MediaItemCard
											key={item.id}
											item={item}
											isSelected={selectedIds.has(item.id)}
											filteredMediaItems={filteredMediaItems}
											folders={folders}
											addToFolder={addToFolder}
											removeFromFolder={removeFromFolder}
											onToggleSelect={toggleSelect}
											onEdit={handleEdit}
											onRemove={handleRemove}
										/>
									))}
								</div>
							)}
						</div>
					</ScrollArea>
				</div>
			</div>
		</div>
	);
}
