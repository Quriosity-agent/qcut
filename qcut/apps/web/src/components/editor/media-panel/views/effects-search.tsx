import { useState, useMemo, useEffect } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  sortBy: 'name' | 'category' | 'recent' | 'popular';
}

export function EffectsSearch({ presets, onSearchResults, className }: EffectsSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    showFavorites: false,
    showRecent: false,
    sortBy: 'name'
  });
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentlyUsed, setRecentlyUsed] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Load favorites and recent from localStorage
  useEffect(() => {
    const savedFavorites = localStorage.getItem('effectsFavorites');
    const savedRecent = localStorage.getItem('effectsRecent');
    
    if (savedFavorites) {
      setFavorites(new Set(JSON.parse(savedFavorites)));
    }
    
    if (savedRecent) {
      setRecentlyUsed(JSON.parse(savedRecent));
    }
  }, []);

  // Save favorites to localStorage
  useEffect(() => {
    localStorage.setItem('effectsFavorites', JSON.stringify(Array.from(favorites)));
  }, [favorites]);

  // Save recent to localStorage
  useEffect(() => {
    localStorage.setItem('effectsRecent', JSON.stringify(recentlyUsed));
  }, [recentlyUsed]);

  const availableCategories: EffectCategory[] = useMemo(() => {
    const categories = new Set<EffectCategory>();
    presets.forEach(preset => categories.add(preset.category));
    return Array.from(categories);
  }, [presets]);

  const filteredAndSortedPresets = useMemo(() => {
    let filtered = presets.filter((preset) => {
      // Search filter
      const matchesSearch = searchQuery === "" || 
        preset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        preset.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        preset.category.toLowerCase().includes(searchQuery.toLowerCase());

      // Category filter
      const matchesCategory = filterOptions.categories.length === 0 || 
        filterOptions.categories.includes(preset.category);

      // Favorites filter
      const matchesFavorites = !filterOptions.showFavorites || 
        favorites.has(preset.id);

      // Recent filter
      const matchesRecent = !filterOptions.showRecent || 
        recentlyUsed.includes(preset.id);

      return matchesSearch && matchesCategory && matchesFavorites && matchesRecent;
    });

    // Sort results
    filtered.sort((a, b) => {
      switch (filterOptions.sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'category':
          return a.category.localeCompare(b.category);
        case 'recent':
          const aIndex = recentlyUsed.indexOf(a.id);
          const bIndex = recentlyUsed.indexOf(b.id);
          if (aIndex === -1 && bIndex === -1) return 0;
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        case 'popular':
          // For now, sort by favorites then alphabetically
          const aFav = favorites.has(a.id) ? 0 : 1;
          const bFav = favorites.has(b.id) ? 0 : 1;
          if (aFav !== bFav) return aFav - bFav;
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return filtered;
  }, [presets, searchQuery, filterOptions, favorites, recentlyUsed]);

  useEffect(() => {
    onSearchResults(filteredAndSortedPresets);
  }, [filteredAndSortedPresets, onSearchResults]);

  const toggleFavorite = (presetId: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(presetId)) {
        newFavorites.delete(presetId);
      } else {
        newFavorites.add(presetId);
      }
      return newFavorites;
    });
  };

  const addToRecent = (presetId: string) => {
    setRecentlyUsed(prev => {
      const newRecent = [presetId, ...prev.filter(id => id !== presetId)].slice(0, 10);
      return newRecent;
    });
  };

  const toggleCategory = (category: EffectCategory) => {
    setFilterOptions(prev => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter(c => c !== category)
        : [...prev.categories, category]
    }));
  };

  const clearFilters = () => {
    setFilterOptions({
      categories: [],
      showFavorites: false,
      showRecent: false,
      sortBy: 'name'
    });
    setSearchQuery("");
  };

  const activeFilterCount = 
    filterOptions.categories.length +
    (filterOptions.showFavorites ? 1 : 0) +
    (filterOptions.showRecent ? 1 : 0) +
    (filterOptions.sortBy !== 'name' ? 1 : 0);

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
        />
        
        {/* Filter Button */}
        <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="text"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
            >
              <Filter className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
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
                <label className="text-sm font-medium">Categories</label>
                <div className="flex flex-wrap gap-2">
                  {availableCategories.map(category => (
                    <Badge
                      key={category}
                      variant={filterOptions.categories.includes(category) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleCategory(category)}
                    >
                      {category}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <Separator />
              
              {/* Quick Filters */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Quick Filters</label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="favorites"
                      checked={filterOptions.showFavorites}
                      onCheckedChange={(checked) => 
                        setFilterOptions(prev => ({ ...prev, showFavorites: !!checked }))
                      }
                    />
                    <label
                      htmlFor="favorites"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                    >
                      <Star className="h-3 w-3" />
                      Favorites only
                    </label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="recent"
                      checked={filterOptions.showRecent}
                      onCheckedChange={(checked) => 
                        setFilterOptions(prev => ({ ...prev, showRecent: !!checked }))
                      }
                    />
                    <label
                      htmlFor="recent"
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
                <label className="text-sm font-medium">Sort by</label>
                <Select
                  value={filterOptions.sortBy}
                  onValueChange={(value: FilterOptions['sortBy']) => 
                    setFilterOptions(prev => ({ ...prev, sortBy: value }))
                  }
                >
                  <SelectTrigger className="w-full">
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
          {filterOptions.categories.map(category => (
            <Badge
              key={category}
              variant="secondary"
              className="gap-1"
            >
              {category}
              <button
                onClick={() => toggleCategory(category)}
                className="ml-1 hover:text-destructive"
              >
                ×
              </button>
            </Badge>
          ))}
          {filterOptions.showFavorites && (
            <Badge variant="secondary" className="gap-1">
              Favorites
              <button
                onClick={() => setFilterOptions(prev => ({ ...prev, showFavorites: false }))}
                className="ml-1 hover:text-destructive"
              >
                ×
              </button>
            </Badge>
          )}
          {filterOptions.showRecent && (
            <Badge variant="secondary" className="gap-1">
              Recent
              <button
                onClick={() => setFilterOptions(prev => ({ ...prev, showRecent: false }))}
                className="ml-1 hover:text-destructive"
              >
                ×
              </button>
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
    const saved = localStorage.getItem('effectsFavorites');
    const favorites = saved ? new Set(JSON.parse(saved)) : new Set();
    
    if (favorites.has(presetId)) {
      favorites.delete(presetId);
    } else {
      favorites.add(presetId);
    }
    
    localStorage.setItem('effectsFavorites', JSON.stringify(Array.from(favorites)));
    return favorites.has(presetId);
  },
  
  addToRecent: (presetId: string) => {
    const saved = localStorage.getItem('effectsRecent');
    const recent = saved ? JSON.parse(saved) : [];
    const newRecent = [presetId, ...recent.filter((id: string) => id !== presetId)].slice(0, 10);
    localStorage.setItem('effectsRecent', JSON.stringify(newRecent));
  },
  
  isFavorite: (presetId: string) => {
    const saved = localStorage.getItem('effectsFavorites');
    const favorites = saved ? new Set(JSON.parse(saved)) : new Set();
    return favorites.has(presetId);
  }
};