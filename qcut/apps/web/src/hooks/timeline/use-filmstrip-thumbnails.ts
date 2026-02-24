import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { extractFrames } from "@/lib/filmstrip/filmstrip-extractor";
import { filmstripCache } from "@/lib/filmstrip/filmstrip-cache";

const TILE_ASPECT_RATIO = 16 / 9;
const DEBOUNCE_MS = 150;
const TILE_PADDING = 8; // matches timeline-element.tsx tileHeight = trackHeight - 8

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

/**
 * Computes filmstrip frame timestamps and triggers extraction.
 * Returns an array of { time, url } for rendering individual tiles.
 * Debounces recalculation on zoom/width changes to avoid thrashing.
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
	const tileHeight = trackHeight - TILE_PADDING;
	const tileWidth = tileHeight * TILE_ASPECT_RATIO;

	const [frames, setFrames] = useState<FilmstripFrame[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Compute the number of visible tiles
	const visibleTiles = useMemo(() => {
		if (!enabled || clipWidthPx <= 0 || tileWidth <= 0) return 0;
		return Math.max(1, Math.ceil(clipWidthPx / tileWidth));
	}, [enabled, clipWidthPx, tileWidth]);

	// Compute frame timestamps based on tile count + trim
	const computeTimestamps = useCallback(
		(tileCount: number): number[] => {
			const trimmedDuration = duration - trimStart - trimEnd;
			if (tileCount <= 0 || trimmedDuration <= 0) return [];

			const timestamps: number[] = [];
			for (let i = 0; i < tileCount; i++) {
				// Sample the center of each tile's time range
				const t =
					trimStart + ((i + 0.5) / tileCount) * trimmedDuration;
				// Quantize to 3 decimal places for cache key stability
				timestamps.push(
					Math.round(Math.max(0, Math.min(t, duration)) * 1000) /
						1000,
				);
			}
			return timestamps;
		},
		[duration, trimStart, trimEnd],
	);

	// Trigger extraction when parameters change (debounced)
	useEffect(() => {
		if (!enabled || !file || visibleTiles === 0) {
			setFrames([]);
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
				setFrames([]);
				return;
			}

			// Immediately show cached frames (or null for uncached)
			const initial: FilmstripFrame[] = timestamps.map((t) => ({
				time: t,
				url: filmstripCache.get(mediaId, t),
			}));
			setFrames(initial);

			// Check if all frames are already cached
			const allCached = initial.every((f) => f.url !== null);
			if (allCached) {
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
				.then((result) => {
					if (controller.signal.aborted) return;
					setFrames(
						timestamps.map((t) => ({
							time: t,
							url: result.get(t) ?? filmstripCache.get(mediaId, t),
						})),
					);
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
	}, [enabled, file, mediaId, visibleTiles, computeTimestamps]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, []);

	return { frames, isLoading, tileWidth, tileHeight };
}
