import { useState, useMemo, useEffect, useId } from "react";
import { Search, Star, Clock, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { EffectPreset, EffectCategory } from "@/types/effects";

interface EffectsSearchProps {
	presets: EffectPreset[];
	onSearchResults: (results: EffectPreset[]) => void;
	className?: string;
}

interface FilterOptions {
	categories: EffectCategory[];
	showFavorites: boolean;
	showRecent: boolean;
	sortBy: "name" | "category" | "recent" | "popular";
}

export function EffectsSearch({
	presets,
	onSearchResults,
	className,
}: EffectsSearchProps) {
	const uid = useId();
	const popoverId = `${uid}-effects-filter-popover`;

	const [searchQuery, setSearchQuery] = useState("");
	const [filterOptions, setFilterOptions] = useState<FilterOptions>({
		categories: [],
		showFavorites: false,
		showRecent: false,
		sortBy: "name",
	});
	const [favorites, setFavorites] = useState<Set<string>>(new Set());
	const [recentlyUsed, setRecentlyUsed] = useState<string[]>([]);
	const [isFilterOpen, setIsFilterOpen] = useState(false);

	// Load favorites and recent from localStorage
	useEffect(() => {
		const savedFavorites = localStorage.getItem("effectsFavorites");
		const savedRecent = localStorage.getItem("effectsRecent");

		if (savedFavorites) {
			try {
				const parsed = JSON.parse(savedFavorites);
				if (Array.isArray(parsed)) {
					setFavorites(new Set(parsed));
				}
			} catch {
				// ignore malformed/legacy data
			}
		}

		if (savedRecent) {
			try {
				const parsed = JSON.parse(savedRecent);
				if (Array.isArray(parsed)) {
					setRecentlyUsed(parsed);
				}
			} catch {
				// ignore malformed/legacy data
			}
		}
	}, []);

	// Save favorites to localStorage
	useEffect(() => {
		try {
			localStorage.setItem(
				"effectsFavorites",
				JSON.stringify(Array.from(favorites))
			);
		} catch {
			// Handle storage quota exceeded or write errors silently
		}
	}, [favorites]);

	// Save recent to localStorage
	useEffect(() => {
		try {
			localStorage.setItem("effectsRecent", JSON.stringify(recentlyUsed));
		} catch {
			// Handle storage quota exceeded or write errors silently
		}
	}, [recentlyUsed]);

	const availableCategories: EffectCategory[] = useMemo(() => {
		const categories = new Set<EffectCategory>();
		for (const preset of presets) categories.add(preset.category);
		return Array.from(categories).sort((a, b) => a.localeCompare(b));
	}, [presets]);

	const filteredAndSortedPresets = useMemo(() => {
		const filtered = presets.filter((preset) => {
			// Search filter
			const matchesSearch =
				searchQuery === "" ||
				preset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				preset.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
				preset.category.toLowerCase().includes(searchQuery.toLowerCase());

			// Category filter
			const matchesCategory =
				filterOptions.categories.length === 0 ||
				filterOptions.categories.includes(preset.category);

			// Favorites filter
			const matchesFavorites =
				!filterOptions.showFavorites || favorites.has(preset.id);

			// Recent filter
			const matchesRecent =
				!filterOptions.showRecent || recentlyUsed.includes(preset.id);

			return (
				matchesSearch && matchesCategory && matchesFavorites && matchesRecent
			);
		});

		// Sort results
		filtered.sort((a, b) => {
			switch (filterOptions.sortBy) {
				case "name":
					return a.name.localeCompare(b.name);
				case "category":
					return a.category.localeCompare(b.category);
				case "recent": {
					const aIndex = recentlyUsed.indexOf(a.id);
					const bIndex = recentlyUsed.indexOf(b.id);
					if (aIndex === -1 && bIndex === -1) return 0;
					if (aIndex === -1) return 1;
					if (bIndex === -1) return -1;
					return aIndex - bIndex;
				}
				case "popular": {
					// For now, sort by favorites then alphabetically
					const aFav = favorites.has(a.id) ? 0 : 1;
					const bFav = favorites.has(b.id) ? 0 : 1;
					if (aFav !== bFav) return aFav - bFav;
					return a.name.localeCompare(b.name);
				}
				default:
					return 0;
			}
		});

		return filtered;
	}, [presets, searchQuery, filterOptions, favorites, recentlyUsed]);

	useEffect(() => {
		onSearchResults(filteredAndSortedPresets);
	}, [filteredAndSortedPresets, onSearchResults]);

	const toggleCategory = (category: EffectCategory) => {
		setFilterOptions((prev) => ({
			...prev,
			categories: prev.categories.includes(category)
				? prev.categories.filter((c) => c !== category)
				: [...prev.categories, category],
		}));
	};

	const clearFilters = () => {
		setFilterOptions({
			categories: [],
			showFavorites: false,
			showRecent: false,
			sortBy: "name",
		});
		setSearchQuery("");
	};

	const activeFilterCount =
		filterOptions.categories.length +
		(filterOptions.showFavorites ? 1 : 0) +
		(filterOptions.showRecent ? 1 : 0) +
		(filterOptions.sortBy !== "name" ? 1 : 0);

	return (
		<div className={cn("space-y-4", className)}>
			{/* Search Bar */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					type="search"
					placeholder="Search effects by name, category..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="pl-10 pr-10"
					aria-label="Search effects"
				/>

				{/* Filter Button */}
				<Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="text"
							size="sm"
							className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
							aria-label={`Filter effects${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}`}
							aria-haspopup="dialog"
							aria-expanded={isFilterOpen}
							aria-controls={popoverId}
						>
							<Filter className="h-4 w-4" />
							{activeFilterCount > 0 && (
								<Badge
									variant="destructive"
									className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
									aria-hidden="true"
								>
									{activeFilterCount}
								</Badge>
							)}
						</Button>
					</PopoverTrigger>
					<PopoverContent id={popoverId} className="w-80" align="end">
						<div className="space-y-4">
							<div className="flex items-center justify-between">
								<h4 className="font-medium">Filters</h4>
								<Button
									variant="text"
									size="sm"
									onClick={clearFilters}
									className="h-auto p-1 text-xs"
								>
									Clear all
								</Button>
							</div>

							<Separator />

							{/* Categories */}
							<div className="space-y-2">
								<span
									id={`${uid}-effects-categories-label`}
									className="text-sm font-medium"
								>
									Categories
								</span>
								<div
									className="flex flex-wrap gap-2"
									role="group"
									aria-labelledby={`${uid}-effects-categories-label`}
								>
									{availableCategories.map((category) => {
										const active = filterOptions.categories.includes(category);
										return (
											<Button
												key={category}
												type="button"
												variant={active ? "secondary" : "outline"}
												size="sm"
												className="h-6 px-2 text-xs"
												aria-pressed={active}
												aria-label={`Toggle ${category} category filter`}
												onClick={() => toggleCategory(category)}
											>
												{category}
											</Button>
										);
									})}
								</div>
							</div>

							<Separator />

							{/* Quick Filters */}
							<div className="space-y-2">
								<span
									id={`${uid}-effects-quickfilters-label`}
									className="text-sm font-medium"
								>
									Quick Filters
								</span>
								<div
									className="space-y-2"
									role="group"
									aria-labelledby={`${uid}-effects-quickfilters-label`}
								>
									<div className="flex items-center space-x-2">
										<Checkbox
											id={`${uid}-favorites`}
											checked={filterOptions.showFavorites}
											onCheckedChange={(checked) =>
												setFilterOptions((prev) => ({
													...prev,
													showFavorites: !!checked,
												}))
											}
										/>
										<label
											htmlFor={`${uid}-favorites`}
											className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
										>
											<Star className="h-3 w-3" />
											Favorites only
										</label>
									</div>

									<div className="flex items-center space-x-2">
										<Checkbox
											id={`${uid}-recent`}
											checked={filterOptions.showRecent}
											onCheckedChange={(checked) =>
												setFilterOptions((prev) => ({
													...prev,
													showRecent: !!checked,
												}))
											}
										/>
										<label
											htmlFor={`${uid}-recent`}
											className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
										>
											<Clock className="h-3 w-3" />
											Recently used
										</label>
									</div>
								</div>
							</div>

							<Separator />

							{/* Sort By */}
							<div className="space-y-2">
								<span
									id={`${uid}-effects-sortby-label`}
									className="text-sm font-medium"
								>
									Sort by
								</span>
								<Select
									value={filterOptions.sortBy}
									onValueChange={(value: FilterOptions["sortBy"]) =>
										setFilterOptions((prev) => ({ ...prev, sortBy: value }))
									}
								>
									<SelectTrigger
										className="w-full"
										aria-labelledby={`${uid}-effects-sortby-label`}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="name">Name</SelectItem>
										<SelectItem value="category">Category</SelectItem>
										<SelectItem value="recent">Recently Used</SelectItem>
										<SelectItem value="popular">Most Popular</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</PopoverContent>
				</Popover>
			</div>

			{/* Active Filters Display */}
			{activeFilterCount > 0 && (
				<div className="flex flex-wrap gap-2">
					{filterOptions.categories.map((category) => (
						<Badge key={category} variant="secondary" className="gap-1">
							{category}
							<Button
								type="button"
								variant="text"
								size="sm"
								onClick={() => toggleCategory(category)}
								className="ml-1 h-4 w-4 p-0 hover:text-destructive"
								aria-label={`Remove ${category} filter`}
							>
								×
							</Button>
						</Badge>
					))}
					{filterOptions.showFavorites && (
						<Badge variant="secondary" className="gap-1">
							Favorites
							<Button
								type="button"
								variant="text"
								size="sm"
								onClick={() =>
									setFilterOptions((prev) => ({
										...prev,
										showFavorites: false,
									}))
								}
								className="ml-1 h-4 w-4 p-0 hover:text-destructive"
								aria-label="Remove Favorites filter"
							>
								×
							</Button>
						</Badge>
					)}
					{filterOptions.showRecent && (
						<Badge variant="secondary" className="gap-1">
							Recent
							<Button
								type="button"
								variant="text"
								size="sm"
								onClick={() =>
									setFilterOptions((prev) => ({ ...prev, showRecent: false }))
								}
								className="ml-1 h-4 w-4 p-0 hover:text-destructive"
								aria-label="Remove Recent filter"
							>
								×
							</Button>
						</Badge>
					)}
				</div>
			)}

			{/* Results Count */}
			<div className="text-sm text-muted-foreground">
				{filteredAndSortedPresets.length} effects found
				{searchQuery && ` for "${searchQuery}"`}
			</div>
		</div>
	);
}

// Export helper functions for managing favorites and recent
export const effectsSearchHelpers = {
	toggleFavorite: (presetId: string) => {
		let favorites: Set<string>;
		try {
			const saved = localStorage.getItem("effectsFavorites");
			if (saved) {
				const parsed = JSON.parse(saved);
				favorites = Array.isArray(parsed) ? new Set(parsed) : new Set();
			} else {
				favorites = new Set();
			}
		} catch {
			// Handle parse errors or storage access errors
			favorites = new Set();
		}

		if (favorites.has(presetId)) {
			favorites.delete(presetId);
		} else {
			favorites.add(presetId);
		}

		try {
			localStorage.setItem(
				"effectsFavorites",
				JSON.stringify(Array.from(favorites))
			);
		} catch {
			// Failed to persist favorites (quota/private mode). Intentionally ignored.
		}

		return favorites.has(presetId);
	},

	addToRecent: (presetId: string) => {
		let recent: string[] = [];
		try {
			const saved = localStorage.getItem("effectsRecent");
			if (saved) {
				const parsed = JSON.parse(saved);
				recent = Array.isArray(parsed) ? parsed : [];
			}
		} catch {
			// Handle parse errors or storage access errors
			recent = [];
		}

		const newRecent = [
			presetId,
			...recent.filter((id: string) => id !== presetId),
		].slice(0, 10);

		try {
			localStorage.setItem("effectsRecent", JSON.stringify(newRecent));
		} catch {
			// Failed to persist recents (quota/private mode). Intentionally ignored.
		}
	},

	isFavorite: (presetId: string) => {
		let favorites: Set<string>;
		try {
			const saved = localStorage.getItem("effectsFavorites");
			if (saved) {
				const parsed = JSON.parse(saved);
				favorites = Array.isArray(parsed) ? new Set(parsed) : new Set();
			} else {
				favorites = new Set();
			}
		} catch {
			// Handle parse errors or storage access errors
			favorites = new Set();
		}

		return favorites.has(presetId);
	},
};
