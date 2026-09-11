import {
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	ChevronDown,
	Download,
	Filter,
	LayoutGrid,
	List,
	ListPlus,
	Loader2,
	Plus,
	RefreshCw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
	MEDIA_LIBRARY_SORT_KEYS,
	type MediaLibrarySort,
	type MediaLibrarySortDirection,
} from "./media-library-view";

export type MediaLibraryFilter = "all" | "video" | "audio" | "image";
export type MediaLibraryViewMode = "grid" | "list";

interface MediaToolbarProps {
	isProcessing: boolean;
	isSyncing: boolean;
	onImport: () => void;
	onSync: () => void;
	searchQuery: string;
	onSearchChange: (value: string) => void;
	viewMode: MediaLibraryViewMode;
	onViewModeChange: (mode: MediaLibraryViewMode) => void;
	sortBy: MediaLibrarySort;
	sortDirection: MediaLibrarySortDirection;
	onSortByChange: (sortBy: MediaLibrarySort) => void;
	onSortDirectionChange: (direction: MediaLibrarySortDirection) => void;
	mediaFilter: MediaLibraryFilter;
	onMediaFilterChange: (filter: MediaLibraryFilter) => void;
}

const iconButtonClass =
	"grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/** Import, search, view toggle, sort and filter: the row above the media grid. */
export function MediaToolbar({
	isProcessing,
	isSyncing,
	onImport,
	onSync,
	searchQuery,
	onSearchChange,
	viewMode,
	onViewModeChange,
	sortBy,
	sortDirection,
	onSortByChange,
	onSortDirectionChange,
	mediaFilter,
	onMediaFilterChange,
}: MediaToolbarProps) {
	const { t } = useTranslation();
	const sortLabels: Record<MediaLibrarySort, string> = {
		importTime: t("media.sortImportTime"),
		createdTime: t("media.sortCreatedTime"),
		name: t("common.name"),
		type: t("media.sortFileType"),
		duration: t("common.duration"),
	};
	const filterOptions: Array<{ value: MediaLibraryFilter; label: string }> = [
		{ value: "all", label: t("common.all") },
		{ value: "video", label: t("common.video") },
		{ value: "audio", label: t("common.audio") },
		{ value: "image", label: t("common.image") },
	];
	const nextViewMode: MediaLibraryViewMode =
		viewMode === "grid" ? "list" : "grid";
	const nextViewLabel =
		nextViewMode === "list" ? t("media.list") : t("media.grid");
	const SortIcon =
		sortDirection === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

	return (
		<div
			className="flex flex-wrap items-center gap-x-1.5 gap-y-2"
			data-testid="media-toolbar"
		>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onClick={onImport}
				disabled={isProcessing}
				className="h-8 shrink-0 gap-1.5 rounded-md px-2.5 text-xs"
				data-testid="import-media-button"
				aria-label={isProcessing ? t("media.importing") : t("media.import")}
			>
				{isProcessing ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
				) : (
					<span className="grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
						<Plus className="size-3!" />
					</span>
				)}
				{t("media.import")}
			</Button>
			<button
				type="button"
				className={iconButtonClass}
				onClick={onSync}
				disabled={isSyncing || isProcessing}
				aria-label={t("media.syncFolder")}
				title={t("media.syncFolder")}
				data-testid="media-sync-button"
			>
				<RefreshCw className={cn("size-4", isSyncing && "animate-spin")} />
			</button>
			{/* The search field takes the remaining width and wraps onto its own
			    row when the panel is too narrow to hold every control. */}
			<div className="relative min-w-[96px] flex-1">
				<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="text"
					placeholder={t("media.searchFileName")}
					className="h-8 pl-7 text-xs"
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					aria-label={t("media.searchFileName")}
				/>
			</div>
			<button
				type="button"
				className={iconButtonClass}
				onClick={() => onViewModeChange(nextViewMode)}
				aria-label={nextViewLabel}
				title={nextViewLabel}
				data-testid="media-view-toggle"
				data-view-mode={viewMode}
			>
				{viewMode === "grid" ? (
					<LayoutGrid className="size-4" />
				) : (
					<List className="size-4" />
				)}
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className={cn(iconButtonClass, "w-auto gap-0.5 px-1.5")}
						aria-label={t("media.sort")}
						title={t("media.sort")}
						data-testid="media-sort-trigger"
					>
						<SortIcon className="size-4" />
						<ChevronDown className="size-3" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-[8.5rem]">
					{MEDIA_LIBRARY_SORT_KEYS.map((key) => (
						<DropdownMenuCheckboxItem
							key={key}
							checked={sortBy === key}
							onCheckedChange={() => onSortByChange(key)}
							className="text-xs"
						>
							{sortLabels[key]}
						</DropdownMenuCheckboxItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuCheckboxItem
						checked={sortDirection === "asc"}
						onCheckedChange={() => onSortDirectionChange("asc")}
						className="text-xs"
					>
						{t("media.sortAscending")}
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={sortDirection === "desc"}
						onCheckedChange={() => onSortDirectionChange("desc")}
						className="text-xs"
					>
						{t("media.sortDescending")}
					</DropdownMenuCheckboxItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className={cn(
							iconButtonClass,
							"w-auto gap-0.5 px-1.5",
							mediaFilter !== "all" && "text-primary"
						)}
						aria-label={t("media.filter")}
						title={t("media.filter")}
						data-testid="media-filter-trigger"
					>
						<Filter className="size-4" />
						<ChevronDown className="size-3" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-[7rem]">
					{filterOptions.map((option) => (
						<DropdownMenuCheckboxItem
							key={option.value}
							checked={mediaFilter === option.value}
							onCheckedChange={() => onMediaFilterChange(option.value)}
							className="text-xs"
						>
							{option.label}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

interface MediaSelectionToolbarProps {
	selectedCount: number;
	totalCount: number;
	onSelectAll: () => void;
	onAddToTimeline: () => void;
	onDownload: () => void;
	onDelete: () => void;
	onClear: () => void;
}

/** Replaces the toolbar while items are selected. */
export function MediaSelectionToolbar({
	selectedCount,
	totalCount,
	onSelectAll,
	onAddToTimeline,
	onDownload,
	onDelete,
	onClear,
}: MediaSelectionToolbarProps) {
	const { t } = useTranslation();
	return (
		<div
			className="flex items-center gap-2"
			data-testid="media-selection-toolbar"
		>
			<span className="whitespace-nowrap text-xs font-medium">
				{t("media.selected", { count: selectedCount })}
			</span>
			{selectedCount < totalCount && (
				<button
					type="button"
					className="whitespace-nowrap text-xs text-primary hover:text-primary/80"
					onClick={onSelectAll}
				>
					{t("media.selectAll")}
				</button>
			)}
			<div className="flex-1" />
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-8 text-xs"
				onClick={onAddToTimeline}
			>
				<ListPlus className="mr-1 h-3.5 w-3.5" />
				{t("media.addTimeline")}
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-8 text-xs"
				onClick={onDownload}
			>
				<Download className="mr-1 h-3.5 w-3.5" />
				{t("common.download")}
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-8 text-xs text-destructive hover:text-destructive"
				onClick={onDelete}
			>
				<Trash2 className="mr-1 h-3.5 w-3.5" />
				{t("common.delete")}
			</Button>
			<Button
				type="button"
				variant="text"
				size="sm"
				className="h-8 text-xs"
				onClick={onClear}
			>
				<X className="mr-1 h-3.5 w-3.5" />
				{t("media.deselect")}
			</Button>
		</div>
	);
}
