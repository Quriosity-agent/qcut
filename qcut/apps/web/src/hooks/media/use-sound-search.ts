import { useEffect } from "react";
import { useSoundsStore } from "@/stores/media/sounds-store";
import { searchSounds } from "@/lib/api-adapter";

/**
 * Custom hook for searching sound effects with race condition protection.
 * Uses global Zustand store to persist search state across tab switches.
 * - Debounced search (300ms)
 * - Race condition protection with cleanup
 * - Proper error handling
 */

export function useSoundSearch(query: string, commercialOnly: boolean) {
	const {
		searchResults,
		isSearching,
		searchError,
		lastSearchQuery,
		currentPage,
		hasNextPage,
		isLoadingMore,
		totalCount,
		setSearchResults,
		setSearching,
		setSearchError,
		setLastSearchQuery,
		setCurrentPage,
		setHasNextPage,
		setTotalCount,
		setLoadingMore,
		appendSearchResults,
		appendTopSounds,
		resetPagination,
	} = useSoundsStore();

	// Load more function for infinite scroll
	const loadMore = async () => {
		if (isLoadingMore || !hasNextPage) return;

		try {
			setLoadingMore(true);
			const nextPage = currentPage + 1;

			// loading more results...

			// Use the new API adapter
			const q = query.trim();
			const result = await searchSounds(q, {
				type: "effects",
				page: nextPage,
				page_size: 20,
				commercial_only: commercialOnly,
			});

			if (result?.success !== false) {
				// load more successful

				// Append to appropriate array based on whether we have a query
				if (q) {
					appendSearchResults(result.results || []);
				} else {
					appendTopSounds(result.results || []);
				}

				setCurrentPage(nextPage);
				setHasNextPage(!!result.next);
				setTotalCount(result.count || 0);
			} else {
				setSearchError(result.error || "Load more failed");
			}
		} catch (err) {
			setSearchError(err instanceof Error ? err.message : "Load more failed");
		} finally {
			setLoadingMore(false);
		}
	};

	useEffect(() => {
		if (!query.trim()) {
			setSearchResults([]);
			setSearchError(null);
			setLastSearchQuery("");
			// Don't reset pagination here - top sounds pagination is managed by prefetcher
			return;
		}

		// If we already searched for this query and have results, don't search again
		if (query === lastSearchQuery && searchResults.length > 0) {
			return;
		}

		let ignore = false;

		const timeoutId = setTimeout(async () => {
			try {
				setSearching(true);
				setSearchError(null);
				resetPagination();

				const q = query.trim();
				const result = await searchSounds(q, {
					type: "effects",
					page: 1,
					page_size: 20,
					commercial_only: commercialOnly,
				});

				if (ignore) return;

				if (result?.success !== false) {
					setSearchResults(result.results || []);
					setLastSearchQuery(q);
					setHasNextPage(!!result.next);
					setTotalCount(result.count || 0);
					setCurrentPage(1);
				} else {
					setSearchError(result.error || "Search failed");
				}
			} catch (err) {
				if (!ignore) {
					setSearchError(err instanceof Error ? err.message : "Search failed");
				}
			} finally {
				if (!ignore) {
					setSearching(false);
				}
			}
		}, 300);

		return () => {
			clearTimeout(timeoutId);
			ignore = true;
		};
	}, [
		query,
		commercialOnly,
		lastSearchQuery,
		searchResults.length,
		setSearchResults,
		setSearching,
		setSearchError,
		setLastSearchQuery,
		setCurrentPage,
		setHasNextPage,
		setTotalCount,
		resetPagination,
	]);

	return {
		results: searchResults,
		isLoading: isSearching,
		error: searchError,
		loadMore,
		hasNextPage,
		isLoadingMore,
		totalCount,
	};
}
