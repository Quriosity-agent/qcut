import type { AssetFileRole } from "@qcut/editor-core";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

const CACHE_DATABASE_NAME = "qcut-asset-resources";
const CACHE_DATABASE_VERSION = 1;

export interface CachedAssetResource {
	assetIdentity: string;
	assetKey: string;
	byteSize: number;
	cacheKey: string;
	cachedAt: number;
	checksumSha256: string;
	fileIndex: number;
	lastAccessedAt: number;
	mimeType: string;
	role: AssetFileRole;
	sourceUrl: string;
	version: number;
	blob: Blob;
}

export interface AssetResourceCacheStorage {
	get: ({
		cacheKey,
	}: {
		cacheKey: string;
	}) => Promise<CachedAssetResource | null>;
	put: ({ resource }: { resource: CachedAssetResource }) => Promise<void>;
	remove: ({ cacheKey }: { cacheKey: string }) => Promise<void>;
	removeMany?: ({
		cacheKeys,
	}: {
		cacheKeys: readonly string[];
	}) => Promise<void>;
	list: () => Promise<CachedAssetResource[]>;
}

interface AssetResourceDatabase extends DBSchema {
	files: {
		key: string;
		value: CachedAssetResource;
		indexes: {
			"by-asset-identity": string;
			"by-last-accessed": number;
		};
	};
}

export class IndexedDbAssetResourceCache implements AssetResourceCacheStorage {
	private databasePromise?: Promise<IDBPDatabase<AssetResourceDatabase>>;

	private database(): Promise<IDBPDatabase<AssetResourceDatabase>> {
		if (typeof indexedDB === "undefined") {
			return Promise.reject(new Error("IndexedDB asset cache is unavailable"));
		}
		this.databasePromise ??= openDB<AssetResourceDatabase>(
			CACHE_DATABASE_NAME,
			CACHE_DATABASE_VERSION,
			{
				upgrade(database) {
					const files = database.createObjectStore("files", {
						keyPath: "cacheKey",
					});
					files.createIndex("by-asset-identity", "assetIdentity");
					files.createIndex("by-last-accessed", "lastAccessedAt");
				},
			}
		).catch((error: unknown) => {
			// Forget a failed open so the next call can try IndexedDB again
			// instead of replaying the same rejection forever.
			this.databasePromise = undefined;
			throw error;
		});
		return this.databasePromise;
	}

	async get({
		cacheKey,
	}: {
		cacheKey: string;
	}): Promise<CachedAssetResource | null> {
		return (await (await this.database()).get("files", cacheKey)) ?? null;
	}

	async put({ resource }: { resource: CachedAssetResource }): Promise<void> {
		await (await this.database()).put("files", resource);
	}

	async remove({ cacheKey }: { cacheKey: string }): Promise<void> {
		await (await this.database()).delete("files", cacheKey);
	}

	async removeMany({
		cacheKeys,
	}: {
		cacheKeys: readonly string[];
	}): Promise<void> {
		if (cacheKeys.length === 0) return;
		const transaction = (await this.database()).transaction(
			"files",
			"readwrite"
		);
		for (const cacheKey of cacheKeys) {
			transaction.store.delete(cacheKey);
		}
		await transaction.done;
	}

	async list(): Promise<CachedAssetResource[]> {
		return (await this.database()).getAll("files");
	}
}

let defaultStorage: AssetResourceCacheStorage | undefined;

/** Process-wide IndexedDB cache, created on first use. */
export function getDefaultAssetResourceStorage(): AssetResourceCacheStorage {
	defaultStorage ??= new IndexedDbAssetResourceCache();
	return defaultStorage;
}
