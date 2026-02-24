/**
 * LRU cache for filmstrip thumbnail Blob URLs.
 * Automatically revokes Blob URLs on eviction to prevent memory leaks.
 */

interface CacheEntry {
	url: string;
	accessedAt: number;
}

export class FilmstripCache {
	private cache = new Map<string, CacheEntry>();
	private maxEntries: number;

	constructor(maxEntries = 500) {
		this.maxEntries = maxEntries;
	}

	private makeKey(mediaId: string, time: number): string {
		return `${mediaId}:${time.toFixed(3)}`;
	}

	get(mediaId: string, time: number): string | null {
		const key = this.makeKey(mediaId, time);
		const entry = this.cache.get(key);
		if (!entry) return null;
		// Update access time for LRU
		entry.accessedAt = Date.now();
		return entry.url;
	}

	set(mediaId: string, time: number, url: string): void {
		const key = this.makeKey(mediaId, time);

		// If key already exists, revoke old URL first
		const existing = this.cache.get(key);
		if (existing && existing.url !== url) {
			URL.revokeObjectURL(existing.url);
		}

		this.cache.set(key, { url, accessedAt: Date.now() });
		this.evictIfNeeded();
	}

	/** Get all cached frame URLs for a media item, keyed by time */
	getAll(mediaId: string): Map<number, string> {
		const prefix = `${mediaId}:`;
		const result = new Map<number, string>();
		for (const [key, entry] of this.cache) {
			if (key.startsWith(prefix)) {
				const time = Number.parseFloat(key.slice(prefix.length));
				entry.accessedAt = Date.now();
				result.set(time, entry.url);
			}
		}
		return result;
	}

	/** Evict all entries for a specific media item */
	evictMedia(mediaId: string): void {
		const prefix = `${mediaId}:`;
		const toDelete: string[] = [];
		for (const [key, entry] of this.cache) {
			if (key.startsWith(prefix)) {
				URL.revokeObjectURL(entry.url);
				toDelete.push(key);
			}
		}
		for (const key of toDelete) {
			this.cache.delete(key);
		}
	}

	clear(): void {
		for (const entry of this.cache.values()) {
			URL.revokeObjectURL(entry.url);
		}
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}

	private evictIfNeeded(): void {
		if (this.cache.size <= this.maxEntries) return;

		// Sort entries by access time (oldest first) and evict ~20%
		const entries = [...this.cache.entries()].sort(
			(a, b) => a[1].accessedAt - b[1].accessedAt
		);
		const toRemove = Math.max(1, Math.floor(entries.length * 0.2));
		for (let i = 0; i < toRemove; i++) {
			const [key, entry] = entries[i];
			URL.revokeObjectURL(entry.url);
			this.cache.delete(key);
		}
	}
}

/** Shared singleton cache instance */
export const filmstripCache = new FilmstripCache(500);
