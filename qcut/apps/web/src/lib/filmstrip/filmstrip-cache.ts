/**
 * LRU cache for filmstrip thumbnail Blob URLs.
 *
 * The cache owns every URL it hands out. A consumer that paints a frame
 * retains it for as long as the frame is on screen; retained entries are
 * never evicted, so a URL a clip is painting stays valid until the clip
 * releases it. Everything else is evicted least-recently-used and revoked on
 * eviction. Dropping a whole media item or clearing the cache while a frame
 * is retained only orphans that entry: its URL is revoked on the release
 * that brings the count to zero.
 */

interface CacheEntry {
	url: string;
	accessedAt: number;
	retainCount: number;
}

export class FilmstripCache {
	private cache = new Map<string, CacheEntry>();
	/** Entries dropped while retained; revoked once their last consumer lets go. */
	private orphans = new Map<string, CacheEntry>();
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

	/**
	 * Stores a freshly captured frame and returns the URL the cache owns for
	 * that timestamp. When a capture of the same frame already landed, the
	 * existing URL wins and the duplicate is revoked instead: a clip may still
	 * be painting the earlier URL, so it is never pulled out from under it.
	 */
	set(mediaId: string, time: number, url: string): string {
		const key = this.makeKey(mediaId, time);
		const existing = this.cache.get(key);
		if (existing) {
			existing.accessedAt = Date.now();
			if (existing.url !== url) URL.revokeObjectURL(url);
			return existing.url;
		}
		this.cache.set(key, { url, accessedAt: Date.now(), retainCount: 0 });
		this.evictIfNeeded(key);
		return url;
	}

	/**
	 * Marks a frame as on screen and returns its URL, or null when the frame
	 * is not cached. Every successful retain must be paired with a release.
	 */
	retain(mediaId: string, time: number): string | null {
		const entry = this.cache.get(this.makeKey(mediaId, time));
		if (!entry) return null;
		entry.retainCount++;
		entry.accessedAt = Date.now();
		return entry.url;
	}

	release(mediaId: string, time: number): void {
		const key = this.makeKey(mediaId, time);
		const entry = this.cache.get(key) ?? this.orphans.get(key);
		if (!entry || entry.retainCount === 0) return;
		entry.retainCount--;
		if (entry.retainCount === 0 && this.orphans.delete(key)) {
			URL.revokeObjectURL(entry.url);
		}
	}

	retainCount(mediaId: string, time: number): number {
		return this.cache.get(this.makeKey(mediaId, time))?.retainCount ?? 0;
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
		for (const [key, entry] of [...this.cache]) {
			if (key.startsWith(prefix)) this.drop(key, entry);
		}
	}

	clear(): void {
		for (const [key, entry] of [...this.cache]) {
			this.drop(key, entry);
		}
	}

	/** Remove an entry; revoke now, or on release if a consumer still paints it. */
	private drop(key: string, entry: CacheEntry): void {
		this.cache.delete(key);
		if (entry.retainCount > 0) {
			this.orphans.set(key, entry);
		} else {
			URL.revokeObjectURL(entry.url);
		}
	}

	get size(): number {
		return this.cache.size;
	}

	private evictIfNeeded(keepKey: string): void {
		if (this.cache.size <= this.maxEntries) return;

		// Only frames nobody is painting are candidates, oldest access first. The
		// entry just stored is about to be handed to the caller, so it stays.
		const candidates = [...this.cache.entries()]
			.filter(([key, entry]) => key !== keepKey && entry.retainCount === 0)
			.sort((a, b) => a[1].accessedAt - b[1].accessedAt);
		// Evict ~20% so the next few inserts do not each pay for a sort.
		const toRemove = Math.min(
			candidates.length,
			Math.max(1, Math.floor(this.cache.size * 0.2))
		);
		for (let i = 0; i < toRemove; i++) {
			const [key, entry] = candidates[i];
			URL.revokeObjectURL(entry.url);
			this.cache.delete(key);
		}
	}
}

/** Shared singleton cache instance */
export const filmstripCache = new FilmstripCache(500);
