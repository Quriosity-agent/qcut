import {
	assetManifestIdentity,
	assetManifestVersionKey,
	type AssetFileRole,
	type AssetManifestEntry,
	type AssetManifestFile,
} from "@qcut/editor-core";
import {
	type AssetResourceCacheStorage,
	type CachedAssetResource,
	getDefaultAssetResourceStorage,
} from "./asset-resource-cache-storage";
import {
	DEFAULT_MAX_FILE_BYTES,
	copyToArrayBuffer,
	fetchResourceWithRetry,
	sha256,
} from "./asset-resource-fetch";

// The storage layer moved to its own module; keep the original import surface.
export { IndexedDbAssetResourceCache } from "./asset-resource-cache-storage";
export type {
	AssetResourceCacheStorage,
	CachedAssetResource,
} from "./asset-resource-cache-storage";

export interface ResolvedAssetResource {
	byteSize?: number;
	cacheKey: string;
	checksumSha256?: string;
	fromCache: boolean;
	mimeType?: string;
	role: AssetFileRole;
	sourceUrl: string;
	url: string;
	blob?: Blob;
}

export interface AssetResourceCacheInspection {
	cachedBytes: number;
	cachedResourceCount: number;
	complete: boolean;
	missingCacheKeys: string[];
	resourceCount: number;
}

function resourceCacheKey({
	asset,
	fileIndex,
	file,
}: {
	asset: AssetManifestEntry;
	file: AssetManifestFile;
	fileIndex: number;
}): string {
	return `${assetManifestVersionKey({
		kind: asset.kind,
		id: asset.id,
		version: asset.version,
	})}:${file.role}:${fileIndex}`;
}

async function cachedResourceMatches({
	cached,
	file,
}: {
	cached: CachedAssetResource;
	file: AssetManifestFile;
}): Promise<boolean> {
	if (!cachedResourceMetadataMatches({ cached, file })) return false;
	if (file.checksumSha256 === undefined) return true;
	const checksumSha256 = await sha256({
		bytes: new Uint8Array(await cached.blob.arrayBuffer()),
	});
	return checksumSha256 === file.checksumSha256.toLocaleLowerCase();
}

function cachedResourceMetadataMatches({
	cached,
	file,
}: {
	cached: CachedAssetResource;
	file: AssetManifestFile;
}): boolean {
	if (cached.blob.size !== cached.byteSize) return false;
	if (file.byteSize !== undefined && cached.blob.size !== file.byteSize) {
		return false;
	}
	return (
		cached.sourceUrl === file.url &&
		(file.byteSize === undefined || cached.byteSize === file.byteSize) &&
		(file.checksumSha256 === undefined ||
			cached.checksumSha256 === file.checksumSha256.toLocaleLowerCase())
	);
}

function selectedAssetFiles({
	asset,
	roles,
}: {
	asset: AssetManifestEntry;
	roles?: readonly AssetFileRole[];
}): Array<{ file: AssetManifestFile; fileIndex: number }> {
	const roleSet = roles ? new Set(roles) : undefined;
	return asset.files
		.map((file, fileIndex) => ({ file, fileIndex }))
		.filter(({ file }) => !roleSet || roleSet.has(file.role));
}

async function ensureFetchedResource({
	asset,
	fetchImpl,
	file,
	fileIndex,
	maxFileBytes,
	now,
	onProgress,
	retryCount,
	signal,
	storage,
}: {
	asset: AssetManifestEntry;
	fetchImpl: typeof fetch;
	file: AssetManifestFile;
	fileIndex: number;
	maxFileBytes: number;
	now: () => number;
	onProgress?: ({
		loadedBytes,
		totalBytes,
	}: {
		loadedBytes: number;
		totalBytes?: number;
	}) => void;
	retryCount: number;
	signal?: AbortSignal;
	storage: AssetResourceCacheStorage;
}): Promise<ResolvedAssetResource> {
	const cacheKey = resourceCacheKey({ asset, file, fileIndex });
	const cached = await storage.get({ cacheKey });
	if (cached && (await cachedResourceMatches({ cached, file }))) {
		await storage.put({
			resource: { ...cached, lastAccessedAt: now() },
		});
		return {
			blob: cached.blob,
			byteSize: cached.byteSize,
			cacheKey,
			checksumSha256: cached.checksumSha256,
			fromCache: true,
			mimeType: cached.mimeType,
			role: file.role,
			sourceUrl: cached.sourceUrl,
			url: file.url,
		};
	}
	if (cached) await storage.remove({ cacheKey });

	const { bytes, mimeType } = await fetchResourceWithRetry({
		attempt: 0,
		fetchImpl,
		file,
		maxFileBytes,
		onProgress,
		retryCount,
		signal,
	});
	if (file.byteSize !== undefined && bytes.byteLength !== file.byteSize) {
		throw new Error(
			`Asset resource size mismatch: expected ${file.byteSize}, received ${bytes.byteLength}`
		);
	}
	const checksumSha256 = await sha256({ bytes });
	if (
		file.checksumSha256 &&
		checksumSha256 !== file.checksumSha256.toLocaleLowerCase()
	) {
		throw new Error(`Asset resource checksum mismatch: ${file.url}`);
	}
	const timestamp = now();
	const blob = new Blob([copyToArrayBuffer({ bytes })], { type: mimeType });
	await storage.put({
		resource: {
			assetIdentity: assetManifestIdentity({ kind: asset.kind, id: asset.id }),
			assetKey: assetManifestVersionKey({
				kind: asset.kind,
				id: asset.id,
				version: asset.version,
			}),
			blob,
			byteSize: bytes.byteLength,
			cacheKey,
			cachedAt: timestamp,
			checksumSha256,
			fileIndex,
			lastAccessedAt: timestamp,
			mimeType,
			role: file.role,
			sourceUrl: file.url,
			version: asset.version,
		},
	});
	return {
		blob,
		byteSize: bytes.byteLength,
		cacheKey,
		checksumSha256,
		fromCache: false,
		mimeType,
		role: file.role,
		sourceUrl: file.url,
		url: file.url,
	};
}

async function ensureFetchedResources({
	asset,
	fetchImpl,
	maxFileBytes,
	now,
	onProgress,
	retryCount,
	selectedFiles,
	signal,
	storage,
}: {
	asset: AssetManifestEntry;
	fetchImpl: typeof fetch;
	maxFileBytes: number;
	now: () => number;
	onProgress?: ({ progress }: { progress: number }) => void;
	retryCount: number;
	selectedFiles: Array<{ file: AssetManifestFile; fileIndex: number }>;
	signal?: AbortSignal;
	storage: AssetResourceCacheStorage;
}): Promise<ResolvedAssetResource[]> {
	const progressByFile = new Map<number, number>();
	const updateProgress = ({
		fileIndex,
		loadedBytes,
		totalBytes,
	}: {
		fileIndex: number;
		loadedBytes: number;
		totalBytes?: number;
	}) => {
		progressByFile.set(
			fileIndex,
			totalBytes && totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 0.5
		);
		const aggregate = selectedFiles.reduce(
			(total, selected) =>
				total + (progressByFile.get(selected.fileIndex) ?? 0),
			0
		);
		onProgress?.({ progress: aggregate / selectedFiles.length });
	};

	const resources = await Promise.all(
		selectedFiles.map(async ({ file, fileIndex }) => {
			const resource = await ensureFetchedResource({
				asset,
				fetchImpl,
				file,
				fileIndex,
				maxFileBytes,
				now,
				onProgress: ({ loadedBytes, totalBytes }) =>
					updateProgress({ fileIndex, loadedBytes, totalBytes }),
				retryCount,
				signal,
				storage,
			});
			progressByFile.set(fileIndex, 1);
			return resource;
		})
	);
	onProgress?.({ progress: 1 });
	return resources;
}

export async function ensureAssetResources({
	asset,
	cacheBundledResources = false,
	fetchImpl = fetch,
	maxFileBytes = DEFAULT_MAX_FILE_BYTES,
	now = Date.now,
	onProgress,
	retryCount = 2,
	roles,
	signal,
	storage = getDefaultAssetResourceStorage(),
}: {
	asset: AssetManifestEntry;
	cacheBundledResources?: boolean;
	fetchImpl?: typeof fetch;
	maxFileBytes?: number;
	now?: () => number;
	onProgress?: ({ progress }: { progress: number }) => void;
	retryCount?: number;
	roles?: readonly AssetFileRole[];
	signal?: AbortSignal;
	storage?: AssetResourceCacheStorage;
}): Promise<ResolvedAssetResource[]> {
	const selectedFiles = selectedAssetFiles({ asset, roles });
	if (asset.delivery !== "remote") {
		if (
			asset.delivery === "bundled" &&
			cacheBundledResources &&
			selectedFiles.length > 0
		) {
			return ensureFetchedResources({
				asset,
				fetchImpl,
				maxFileBytes,
				now,
				onProgress,
				retryCount,
				selectedFiles,
				signal,
				storage,
			});
		}
		return selectedFiles.map(({ file, fileIndex }) => ({
			byteSize: file.byteSize,
			cacheKey: resourceCacheKey({ asset, file, fileIndex }),
			checksumSha256: file.checksumSha256,
			fromCache: true,
			mimeType: file.mimeType,
			role: file.role,
			sourceUrl: file.url,
			url: file.url,
		}));
	}
	if (selectedFiles.length === 0) {
		throw new Error(
			`Remote asset has no matching files: ${asset.kind}:${asset.id}`
		);
	}
	return ensureFetchedResources({
		asset,
		fetchImpl,
		maxFileBytes,
		now,
		onProgress,
		retryCount,
		selectedFiles,
		signal,
		storage,
	});
}

export async function inspectAssetResources({
	asset,
	roles,
	storage = getDefaultAssetResourceStorage(),
	verifyChecksum = false,
}: {
	asset: AssetManifestEntry;
	roles?: readonly AssetFileRole[];
	storage?: AssetResourceCacheStorage;
	verifyChecksum?: boolean;
}): Promise<AssetResourceCacheInspection> {
	const selectedFiles = selectedAssetFiles({ asset, roles });
	if (asset.delivery !== "remote") {
		return {
			cachedBytes: selectedFiles.reduce(
				(total, { file }) => total + (file.byteSize ?? 0),
				0
			),
			cachedResourceCount: selectedFiles.length,
			complete: true,
			missingCacheKeys: [],
			resourceCount: selectedFiles.length,
		};
	}
	if (selectedFiles.length === 0) {
		throw new Error(
			`Remote asset has no matching files: ${asset.kind}:${asset.id}`
		);
	}

	const inspected = await Promise.all(
		selectedFiles.map(async ({ file, fileIndex }) => {
			const cacheKey = resourceCacheKey({ asset, file, fileIndex });
			const cached = await storage.get({ cacheKey });
			const matches = cached
				? verifyChecksum
					? await cachedResourceMatches({ cached, file })
					: cachedResourceMetadataMatches({ cached, file })
				: false;
			return { cacheKey, cached: matches ? cached : null };
		})
	);
	const cached = inspected.filter(
		(entry): entry is { cacheKey: string; cached: CachedAssetResource } =>
			entry.cached !== null
	);
	return {
		cachedBytes: cached.reduce(
			(total, entry) => total + entry.cached.byteSize,
			0
		),
		cachedResourceCount: cached.length,
		complete: cached.length === selectedFiles.length,
		missingCacheKeys: inspected
			.filter((entry) => entry.cached === null)
			.map((entry) => entry.cacheKey),
		resourceCount: selectedFiles.length,
	};
}

export async function removeAssetResourceVersion({
	asset,
	storage = getDefaultAssetResourceStorage(),
}: {
	asset: AssetManifestEntry;
	storage?: AssetResourceCacheStorage;
}): Promise<number> {
	return removeAssetResourceVersions({ assets: [asset], storage });
}

async function removeCacheKeysInBatches({
	batchSize,
	cacheKeys,
	index,
	storage,
}: {
	batchSize: number;
	cacheKeys: readonly string[];
	index: number;
	storage: AssetResourceCacheStorage;
}): Promise<void> {
	const batch = cacheKeys.slice(index, index + batchSize);
	if (batch.length === 0) return;
	await Promise.all(batch.map((cacheKey) => storage.remove({ cacheKey })));
	return removeCacheKeysInBatches({
		batchSize,
		cacheKeys,
		index: index + batchSize,
		storage,
	});
}

export async function removeAssetResourceVersions({
	assets,
	concurrency = 8,
	storage = getDefaultAssetResourceStorage(),
}: {
	assets: readonly AssetManifestEntry[];
	concurrency?: number;
	storage?: AssetResourceCacheStorage;
}): Promise<number> {
	const assetKeys = new Set(
		assets.map((asset) =>
			assetManifestVersionKey({
				kind: asset.kind,
				id: asset.id,
				version: asset.version,
			})
		)
	);
	if (assetKeys.size === 0) return 0;
	const matchingCacheKeys = (await storage.list())
		.filter((resource) => assetKeys.has(resource.assetKey))
		.map((resource) => resource.cacheKey);
	if (storage.removeMany) {
		await storage.removeMany({ cacheKeys: matchingCacheKeys });
		return matchingCacheKeys.length;
	}
	const normalizedConcurrency = Number.isFinite(concurrency)
		? Math.floor(concurrency)
		: 1;
	await removeCacheKeysInBatches({
		batchSize: Math.max(1, Math.min(32, normalizedConcurrency)),
		cacheKeys: matchingCacheKeys,
		index: 0,
		storage,
	});
	return matchingCacheKeys.length;
}

export async function pruneAssetResourceCache({
	maxBytes,
	protectedAssetKeys = [],
	storage = getDefaultAssetResourceStorage(),
}: {
	maxBytes: number;
	protectedAssetKeys?: readonly string[];
	storage?: AssetResourceCacheStorage;
}): Promise<{ remainingBytes: number; removedCount: number }> {
	const protectedKeys = new Set(protectedAssetKeys);
	const resources = await storage.list();
	let remainingBytes = resources.reduce(
		(total, resource) => total + resource.byteSize,
		0
	);
	const removable = resources
		.filter((resource) => !protectedKeys.has(resource.assetKey))
		.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
	const remove: CachedAssetResource[] = [];
	for (const resource of removable) {
		if (remainingBytes <= Math.max(0, maxBytes)) break;
		remove.push(resource);
		remainingBytes -= resource.byteSize;
	}
	await Promise.all(
		remove.map((resource) => storage.remove({ cacheKey: resource.cacheKey }))
	);
	return { remainingBytes, removedCount: remove.length };
}
