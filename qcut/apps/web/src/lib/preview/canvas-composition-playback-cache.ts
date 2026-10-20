export const CANVAS_PLAYBACK_CACHE_MAX_BYTES = 2 * 1024 ** 3;
export const CANVAS_PLAYBACK_CACHE_DIRECTORY = "composition-playback";
const MANAGED_GENERATION = /^v1-[0-9a-f-]{36}$/;
const ownershipName = ({ id }: { id: string }) =>
	`qcut-composition-playback:${id}`;

export interface CanvasPlaybackCache {
	readonly id: string;
	write: ({
		frame,
		blob,
		signal,
	}: {
		frame: number;
		blob: Blob;
		signal: AbortSignal;
	}) => Promise<void>;
	read: ({
		frame,
		signal,
	}: {
		frame: number;
		signal: AbortSignal;
	}) => Promise<Blob>;
	dispose: () => Promise<void>;
	readonly bytes: number;
	readonly frameCount: number;
	readonly cleanupWarnings?: readonly string[];
	readonly cleanupError?: Error;
}

function isMissingEntry({ error }: { error: unknown }) {
	return error instanceof DOMException && error.name === "NotFoundError";
}

async function acquireOwnership({
	locks,
	id,
}: {
	locks: LockManager;
	id: string;
}) {
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let acquired = () => {};
	let failed: (error: unknown) => void = () => {};
	const acquisition = new Promise<void>((resolve, reject) => {
		acquired = resolve;
		failed = reject;
	});
	const operation = locks.request(
		ownershipName({ id }),
		{ mode: "exclusive", ifAvailable: true },
		async (lock) => {
			if (!lock) throw new Error("Effect playback cache already owned");
			acquired();
			await held;
		}
	);
	void operation.catch(failed);
	await acquisition;
	return async () => {
		release();
		await operation;
	};
}

async function reclaimInactiveGenerations({
	parent,
	locks,
}: {
	parent: FileSystemDirectoryHandle;
	locks: LockManager;
}) {
	const warnings: string[] = [];
	for await (const [id, handle] of parent.entries()) {
		if (handle.kind !== "directory") continue;
		if (!MANAGED_GENERATION.test(id)) {
			warnings.push(`Unmanaged preview cache retained: ${id}`);
			continue;
		}
		await locks.request(
			ownershipName({ id }),
			{ mode: "exclusive", ifAvailable: true },
			async (lock) => {
				if (!lock) return;
				try {
					await parent.removeEntry(id, { recursive: true });
				} catch (error) {
					if (isMissingEntry({ error })) return;
					throw new Error(`Unable to reclaim effect playback cache ${id}`, {
						cause: error,
					});
				}
			}
		);
	}
	return warnings;
}

export async function createCanvasPlaybackCache({
	maxBytes = CANVAS_PLAYBACK_CACHE_MAX_BYTES,
}: {
	maxBytes?: number;
} = {}): Promise<CanvasPlaybackCache> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new Error("Invalid composition playback cache limit");
	if (!navigator.storage?.getDirectory)
		throw new Error("This browser cannot store an effect playback preview");
	const root = await navigator.storage.getDirectory();
	const parent = await root.getDirectoryHandle(
		CANVAS_PLAYBACK_CACHE_DIRECTORY,
		{
			create: true,
		}
	);
	const locks =
		typeof navigator.locks?.request === "function"
			? navigator.locks
			: undefined;
	const cleanupWarnings = locks
		? await reclaimInactiveGenerations({ parent, locks })
		: ["Web Locks unavailable; crash cache reclamation disabled"];
	const generation = `${locks ? "v1" : "unmanaged"}-${crypto.randomUUID()}`;
	const releaseOwnership = locks
		? await acquireOwnership({ locks, id: generation })
		: async () => {};
	let directory: FileSystemDirectoryHandle;
	try {
		// Acquire ownership before creating a directory another window can discover.
		directory = await parent.getDirectoryHandle(generation, { create: true });
	} catch (error) {
		await releaseOwnership();
		throw error;
	}
	const frames = new Map<number, number>();
	let bytes = 0;
	let disposed = false;
	let tail = Promise.resolve();
	let disposal: Promise<void> | undefined;
	let cleanupError: Error | undefined;

	function assertActive({
		frame,
		signal,
	}: {
		frame: number;
		signal: AbortSignal;
	}) {
		signal.throwIfAborted();
		if (disposed) throw new Error("Composition playback cache disposed");
		if (!Number.isSafeInteger(frame) || frame < 0)
			throw new Error("Invalid composition playback frame");
	}

	function enqueue<Result>({ run }: { run: () => Promise<Result> }) {
		const operation = tail.then(run);
		tail = operation.then(
			() => {},
			() => {}
		);
		return operation;
	}

	function write({
		frame,
		blob,
		signal,
	}: {
		frame: number;
		blob: Blob;
		signal: AbortSignal;
	}) {
		return enqueue({
			run: async () => {
				assertActive({ frame, signal });
				if (frames.has(frame))
					throw new Error("Composition playback frame already written");
				if (blob.size === 0 || blob.type !== "image/png")
					throw new Error("Composition playback needs a non-empty PNG");
				if (bytes + blob.size > maxBytes)
					throw new Error(
						"Effect playback preview exceeds its disk cache limit"
					);
				const name = `${frame}.png`;
				let writable: FileSystemWritableFileStream | undefined;
				try {
					const file = await directory.getFileHandle(name, { create: true });
					assertActive({ frame, signal });
					writable = await file.createWritable();
					assertActive({ frame, signal });
					await writable.write(blob);
					assertActive({ frame, signal });
					await writable.close();
					writable = undefined;
					assertActive({ frame, signal });
					frames.set(frame, blob.size);
					bytes += blob.size;
				} catch (error) {
					await writable?.abort().catch(() => {});
					await directory.removeEntry(name).catch(() => {});
					throw error;
				}
			},
		});
	}

	function read({ frame, signal }: { frame: number; signal: AbortSignal }) {
		return enqueue({
			run: async () => {
				assertActive({ frame, signal });
				const expectedBytes = frames.get(frame);
				if (expectedBytes === undefined)
					throw new Error("Composition playback frame is not prepared");
				const file = await directory.getFileHandle(`${frame}.png`);
				assertActive({ frame, signal });
				const blob = await file.getFile();
				assertActive({ frame, signal });
				if (blob.size !== expectedBytes)
					throw new Error("Composition playback frame is incomplete");
				return blob;
			},
		});
	}

	function dispose() {
		disposed = true;
		disposal ??= tail.then(async () => {
			try {
				await parent.removeEntry(generation, { recursive: true });
			} catch (error) {
				if (!isMissingEntry({ error })) {
					cleanupError = new Error(
						`Unable to remove effect playback cache ${generation}`,
						{ cause: error }
					);
					throw cleanupError;
				}
			} finally {
				await releaseOwnership();
			}
			frames.clear();
			bytes = 0;
		});
		return disposal;
	}

	return {
		id: generation,
		write,
		read,
		dispose,
		cleanupWarnings,
		get cleanupError() {
			return cleanupError;
		},
		get bytes() {
			return bytes;
		},
		get frameCount() {
			return frames.size;
		},
	};
}
