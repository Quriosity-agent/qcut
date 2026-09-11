import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { extractFrames } from "@/lib/filmstrip/filmstrip-extractor";
import { filmstripCache } from "@/lib/filmstrip/filmstrip-cache";

const TILE_ASPECT_RATIO = 16 / 9;
export const DEBOUNCE_MS = 150;
const TILE_PADDING = 8; // matches timeline-element.tsx tileHeight = trackHeight - 8
export const MAX_FILMSTRIP_TILES = 24;

export function calculateFilmstripLayout({
	clipWidthPx,
	trackHeight,
	enabled,
}: {
	clipWidthPx: number;
	trackHeight: number;
	enabled: boolean;
}): { tileCount: number; tileWidth: number; tileHeight: number } {
	const tileHeight = Math.max(1, trackHeight - TILE_PADDING);
	const naturalTileWidth = tileHeight * TILE_ASPECT_RATIO;
	if (!enabled || clipWidthPx <= 0) {
		return { tileCount: 0, tileWidth: naturalTileWidth, tileHeight };
	}
	const requestedTileCount = Math.max(
		1,
		Math.ceil(clipWidthPx / naturalTileWidth)
	);
	const tileCount = Math.min(requestedTileCount, MAX_FILMSTRIP_TILES);
	const tileWidth =
		requestedTileCount > MAX_FILMSTRIP_TILES
			? clipWidthPx / tileCount
			: naturalTileWidth;
	return { tileCount, tileWidth, tileHeight };
}

export interface UseFilmstripOptions {
	mediaId: string;
	file: File | undefined;
	duration: number;
	trimStart: number;
	trimEnd: number;
	zoomLevel: number;
	trackHeight: number;
	clipWidthPx: number;
	enabled: boolean;
}

export interface FilmstripFrame {
	time: number;
	url: string | null;
}

export interface FilmstripResult {
	frames: FilmstripFrame[];
	isLoading: boolean;
	tileWidth: number;
	tileHeight: number;
}

interface RetainedFrame {
	mediaId: string;
	time: number;
}

/**
 * Computes filmstrip frame timestamps and triggers extraction.
 * Returns an array of { time, url } for rendering individual tiles.
 * Debounces recalculation on zoom/width changes to avoid thrashing.
 *
 * Frame URLs belong to the filmstrip cache. The hook retains every frame it
 * hands to the clip and releases it once the clip stops showing it, so the
 * cache never revokes a URL that is still being painted.
 */
export function useFilmstripThumbnails({
	mediaId,
	file,
	duration,
	trimStart,
	trimEnd,
	zoomLevel,
	trackHeight,
	clipWidthPx,
	enabled,
}: UseFilmstripOptions): FilmstripResult {
	const layout = useMemo(
		() => calculateFilmstripLayout({ clipWidthPx, trackHeight, enabled }),
		[clipWidthPx, enabled, trackHeight]
	);
	const { tileCount: visibleTiles, tileHeight, tileWidth } = layout;

	const [frames, setFrames] = useState<FilmstripFrame[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const retainedRef = useRef<RetainedFrame[]>([]);

	// Show the cached URL for each timestamp. New frames are retained before
	// the previous set is released so a frame present in both never drops to
	// zero references and becomes evictable in between.
	const publishFrames = useCallback(
		(timestamps: number[]): FilmstripFrame[] => {
			const next = timestamps.map((time) => ({
				time,
				url: filmstripCache.retain(mediaId, time),
			}));
			for (const retained of retainedRef.current) {
				filmstripCache.release(retained.mediaId, retained.time);
			}
			retainedRef.current = next
				.filter((frame) => frame.url !== null)
				.map((frame) => ({ mediaId, time: frame.time }));
			setFrames(next);
			return next;
		},
		[mediaId]
	);

	// Compute frame timestamps based on tile count + trim
	const computeTimestamps = useCallback(
		(tileCount: number): number[] => {
			const trimmedDuration = duration - trimStart - trimEnd;
			if (tileCount <= 0 || trimmedDuration <= 0) return [];

			const timestamps: number[] = [];
			for (let i = 0; i < tileCount; i++) {
				// Sample the center of each tile's time range
				const t = trimStart + ((i + 0.5) / tileCount) * trimmedDuration;
				// Quantize to 3 decimal places for cache key stability
				timestamps.push(
					Math.round(Math.max(0, Math.min(t, duration)) * 1000) / 1000
				);
			}
			return timestamps;
		},
		[duration, trimStart, trimEnd]
	);

	// Trigger extraction when parameters change (debounced)
	useEffect(() => {
		if (!enabled || !file || visibleTiles === 0) {
			publishFrames([]);
			return;
		}

		// Clear previous debounce
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}

		debounceRef.current = setTimeout(() => {
			// Abort any in-flight extraction
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;

			const timestamps = computeTimestamps(visibleTiles);
			if (timestamps.length === 0) {
				publishFrames([]);
				return;
			}

			// Immediately show cached frames (or null for uncached)
			const initial = publishFrames(timestamps);
			if (initial.every((frame) => frame.url !== null)) {
				setIsLoading(false);
				return;
			}

			setIsLoading(true);

			extractFrames({
				file,
				mediaId,
				timestamps,
				signal: controller.signal,
			})
				.then(() => {
					if (controller.signal.aborted) return;
					// Read the frames back from the cache, which owns their URLs.
					publishFrames(timestamps);
					setIsLoading(false);
				})
				.catch((err) => {
					if (err?.name === "AbortError") return;
					setIsLoading(false);
				});
		}, DEBOUNCE_MS);

		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, [enabled, file, mediaId, visibleTiles, computeTimestamps, publishFrames]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
			for (const retained of retainedRef.current) {
				filmstripCache.release(retained.mediaId, retained.time);
			}
			retainedRef.current = [];
		};
	}, []);

	return { frames, isLoading, tileWidth, tileHeight };
}
