import { useEffect } from "react";
import { useSoundsStore } from "@/stores/sounds-store";

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

      const searchParams = new URLSearchParams({
        page: nextPage.toString(),
        type: "effects",
      });

      if (query.trim()) {
        searchParams.set("q", query);
      }

      searchParams.set("commercial_only", commercialOnly.toString());

      // Try IPC first (Electron), fallback to fetch if not available
      let response;
      try {
        if (window.electronAPI?.invoke) {
          console.log("🔄 [Sound Search] Trying IPC for load more...");
          const ipcResult = await window.electronAPI.invoke("sounds:search", {
            q: query.trim() || undefined,
            type: "effects",
            page: nextPage,
            page_size: 20,
            commercial_only: commercialOnly,
          });

          if (ipcResult.success) {
            console.log("✅ [Sound Search] IPC load more successful");
            response = {
              ok: true,
              status: 200,
              json: () => Promise.resolve(ipcResult.data),
            };
          } else {
            throw new Error(ipcResult.error || "IPC search failed");
          }
        } else {
          throw new Error("No IPC available");
        }
      } catch (ipcError) {
        console.error(
          "❌ [Sound Search] IPC load more failed - no fallback available:",
          ipcError
        );
        throw new Error("Sound search unavailable - Electron IPC required");
      }

      if (response.ok) {
        const data = await response.json();

        // Append to appropriate array based on whether we have a query
        if (query.trim()) {
          appendSearchResults(data.results);
        } else {
          appendTopSounds(data.results);
        }

        setCurrentPage(nextPage);
        setHasNextPage(!!data.next);
        setTotalCount(data.count);
      } else {
        setSearchError(`Load more failed: ${response.status}`);
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

        // Try IPC first (Electron), fallback to fetch if not available
        let response;
        try {
          if (window.electronAPI?.invoke) {
            console.log("🔄 [Sound Search] Trying IPC for search:", query);
            const ipcResult = await window.electronAPI.invoke("sounds:search", {
              q: query,
              type: "effects",
              page: 1,
              page_size: 20,
              commercial_only: commercialOnly,
            });

            // Check if we should ignore the result after async operation
            if (ignore) return;

            if (ipcResult.success) {
              console.log("✅ [Sound Search] IPC search successful");
              response = {
                ok: true,
                status: 200,
                json: () => Promise.resolve(ipcResult.data),
              };
            } else {
              throw new Error(ipcResult.error || "IPC search failed");
            }
          } else {
            throw new Error("No IPC available");
          }
        } catch (ipcError) {
          console.error(
            "❌ [Sound Search] IPC search failed - no fallback available:",
            ipcError
          );
          throw new Error("Sound search unavailable - Electron IPC required");
        }

        if (!ignore) {
          if (response.ok) {
            const data = await response.json();
            setSearchResults(data.results);
            setLastSearchQuery(query);
            setHasNextPage(!!data.next);
            setTotalCount(data.count);
            setCurrentPage(1);
          } else {
            setSearchError(`Search failed: ${response.status}`);
          }
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
