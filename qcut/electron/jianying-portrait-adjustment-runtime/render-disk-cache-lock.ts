import { createHash } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_TIMEOUT_MS = 500;
const LOCK_PORT_START = 16384;
const LOCK_PORT_COUNT = 16384;

export class CacheLeaseUnavailableError extends Error {
	readonly code = "QCUT_NATIVE_CACHE_LEASE_UNAVAILABLE";

	constructor() {
		super("Native render cache lock timed out");
		this.name = "CacheLeaseUnavailableError";
	}
}

function closeLease({ server }: { server: Server }) {
	return new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function tryLease({ port }: { port: number }) {
	return new Promise<Server | null>((resolve, reject) => {
		const server = createServer((socket) => socket.destroy());
		server.maxConnections = 1;
		server.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") resolve(null);
			else reject(error);
		});
		server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
			server.unref();
			resolve(server);
		});
	});
}

export async function withPortraitRenderCacheLock<Result>({
	directory,
	run,
	signal,
	timeoutMs = LOCK_TIMEOUT_MS,
}: {
	directory: string;
	run: () => Promise<Result>;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<Result> {
	signal?.throwIfAborted();
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const canonicalDirectory = await realpath(directory);
	const identity = await stat(canonicalDirectory, { bigint: true });
	// realpath can preserve case aliases on macOS. Missing inode identity
	// shares one conservative lease instead of allowing aliases to diverge.
	const leaseKey =
		identity.dev === 0n || identity.ino === 0n
			? "unknown-directory"
			: `${identity.dev}:${identity.ino}`;
	const digest = createHash("sha256").update(leaseKey).digest();
	const port = LOCK_PORT_START + (digest.readUInt32BE(0) % LOCK_PORT_COUNT);
	const deadline = performance.now() + timeoutMs;

	// The kernel releases this lease on SIGKILL. TTL lockfiles can evict a live,
	// paused writer; stale-file unlink also races with a replacement owner.
	async function acquire(): Promise<Server> {
		signal?.throwIfAborted();
		const server = await tryLease({ port });
		if (server) return server;
		if (performance.now() >= deadline) throw new CacheLeaseUnavailableError();
		await delay(15 + Math.floor(Math.random() * 15), undefined, { signal });
		return acquire();
	}

	const server = await acquire();
	try {
		signal?.throwIfAborted();
		return await run();
	} finally {
		await closeLease({ server });
	}
}
