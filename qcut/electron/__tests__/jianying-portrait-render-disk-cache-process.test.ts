// @vitest-environment node
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPortraitRenderDiskCache } from "../jianying-portrait-adjustment-runtime/render-disk-cache.js";
import {
	CacheLeaseUnavailableError,
	withPortraitRenderCacheLock,
} from "../jianying-portrait-adjustment-runtime/render-disk-cache-lock.js";

type WorkerMessage = { type: "ready" | "temporary" | "done"; file?: string };
const directories: string[] = [];
const children = new Set<ChildProcess>();
let worker: string;

async function temporaryDirectory() {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "native-cache-process-")
	);
	directories.push(directory);
	return directory;
}

beforeAll(async () => {
	const directory = await temporaryDirectory();
	const sources = [
		"jianying-portrait-adjustment-runtime/render-disk-cache.ts",
		"jianying-portrait-adjustment-runtime/render-disk-cache-lock.ts",
		"__tests__/fixtures/portrait-render-disk-cache-process.ts",
	];
	await Promise.all(
		sources.map(async (source) => {
			const input = path.resolve("electron", source);
			const output = path.join(directory, source.replace(/\.ts$/, ".js"));
			await mkdir(path.dirname(output), { recursive: true });
			const compiled = transpileModule(await readFile(input, "utf8"), {
				compilerOptions: {
					module: ModuleKind.CommonJS,
					target: ScriptTarget.ES2022,
					esModuleInterop: true,
				},
			});
			await writeFile(output, compiled.outputText);
		})
	);
	worker = path.join(
		directory,
		"__tests__/fixtures/portrait-render-disk-cache-process.js"
	);
});

afterAll(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

afterEach(async () => {
	await Promise.all(
		[...children].map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			await new Promise<void>((resolve) => {
				child.once("exit", () => resolve());
				child.kill("SIGKILL");
			});
		})
	);
	children.clear();
	// Keep the transpiled worker available for subsequent tests.
	await Promise.all(
		directories
			.splice(1)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

function startWorker({
	directory,
	maxBytes = 10000,
	prefix = "a",
	count = 1,
}: {
	directory: string;
	maxBytes?: number;
	prefix?: string;
	count?: number;
}) {
	const child = fork(worker, [directory, `${maxBytes}`, prefix, `${count}`], {
		stdio: ["ignore", "ignore", "pipe", "ipc"],
		execArgv: [],
	});
	children.add(child);
	let stderr = "";
	child.stderr?.on("data", (data: Buffer) => {
		stderr += data.toString();
	});
	const exited = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0 || signal === "SIGKILL") resolve();
			else reject(new Error(`Cache worker exited ${code}: ${stderr}`));
		});
	});
	function next({ type }: { type: WorkerMessage["type"] }) {
		return new Promise<WorkerMessage>((resolve, reject) => {
			function cleanup() {
				child.removeListener("message", onMessage);
				child.removeListener("exit", onExit);
				child.removeListener("error", onError);
			}
			function onMessage(message: WorkerMessage) {
				if (message.type !== type) return;
				cleanup();
				resolve(message);
			}
			function onExit() {
				cleanup();
				reject(new Error(`Cache worker exited before ${type}: ${stderr}`));
			}
			function onError(error: Error) {
				cleanup();
				reject(error);
			}
			child.on("message", onMessage);
			child.once("exit", onExit);
			child.once("error", onError);
		});
	}
	return { child, exited, next };
}

async function directoryBytes({ directory }: { directory: string }) {
	const files = await readdir(directory);
	const sizes = await Promise.all(
		files.map(async (file) => (await stat(path.join(directory, file))).size)
	);
	return sizes.reduce((total, size) => total + size, 0);
}

describe("native disk cache cross-process ownership", () => {
	it("bounds committed plus temporary bytes throughout concurrent writes", async () => {
		const directory = await temporaryDirectory();
		const maxBytes = 10000;
		const workers = ["a", "b", "c", "d"].map((prefix) =>
			startWorker({ directory, prefix, count: 3, maxBytes })
		);
		await Promise.all(workers.map((item) => item.next({ type: "ready" })));
		const observations = workers.map((item) =>
			Array.from({ length: 3 }).reduce(async (previous) => {
				await previous;
				await item.next({ type: "temporary" });
				try {
					expect(await directoryBytes({ directory })).toBeLessThanOrEqual(
						maxBytes
					);
					expect(
						(await readdir(directory)).filter((file) => file.endsWith(".tmp"))
					).toHaveLength(1);
				} finally {
					item.child.send("release");
				}
			}, Promise.resolve())
		);
		for (const item of workers) item.child.send("start");
		await Promise.all(observations);
		await Promise.all(workers.map((item) => item.exited));
		expect(await directoryBytes({ directory })).toBeLessThanOrEqual(maxBytes);
		expect(
			(await readdir(directory)).some((file) => file.endsWith(".tmp"))
		).toBe(false);
	});

	it("does not reclaim a live writer and reclaims its orphan only after SIGKILL", async () => {
		const directory = await temporaryDirectory();
		const writer = startWorker({ directory });
		await writer.next({ type: "ready" });
		const temporary = writer.next({ type: "temporary" });
		writer.child.send("start");
		const message = await temporary;
		expect(message.file).toBeDefined();
		const orphanBytes = await readFile(message.file!);
		const controller = new AbortController();
		const cache = createPortraitRenderDiskCache({ directory, maxBytes: 10000 });
		const waiting = cache.read({
			key: "f".repeat(64),
			width: 32,
			height: 32,
			signal: controller.signal,
		});
		const rejected = expect(waiting).rejects.toMatchObject({
			name: "AbortError",
		});
		setTimeout(() => controller.abort(), 50);
		await rejected;
		expect(await readFile(message.file!)).toEqual(orphanBytes);
		writer.child.kill("SIGKILL");
		await writer.exited;
		expect(
			await cache.read({ key: "f".repeat(64), width: 32, height: 32 })
		).toBeNull();
		expect(await readdir(directory)).toEqual([]);
		await cache.close();
	});

	it("counts the previous value while reserving its replacement temporary file", async () => {
		const directory = await temporaryDirectory();
		const maxBytes = 4600;
		const key = `a${"0".repeat(63)}`;
		const cache = createPortraitRenderDiskCache({ directory, maxBytes });
		await cache.write({
			key,
			result: {
				provider: "jianying-local-swing-v1",
				width: 32,
				height: 32,
				rgba: randomBytes(4096),
				activeGroups: ["body"],
			},
		});
		const writer = startWorker({ directory, maxBytes });
		await writer.next({ type: "ready" });
		const temporary = writer.next({ type: "temporary" });
		writer.child.send("start");
		await temporary;
		try {
			expect(await directoryBytes({ directory })).toBeLessThanOrEqual(maxBytes);
			expect(
				(await readdir(directory)).filter((file) => file.endsWith(".frame"))
			).toEqual([]);
		} finally {
			writer.child.send("release");
		}
		await writer.exited;
		expect(await cache.read({ key, width: 32, height: 32 })).not.toBeNull();
		await cache.close();
	});

	it("times out conservatively without taking a live lease or deleting its files", async () => {
		const directory = await temporaryDirectory();
		const writer = startWorker({ directory });
		await writer.next({ type: "ready" });
		const temporary = writer.next({ type: "temporary" });
		writer.child.send("start");
		const message = await temporary;
		await expect(
			withPortraitRenderCacheLock({
				directory,
				timeoutMs: 40,
				run: async () => "must not run",
			})
		).rejects.toBeInstanceOf(CacheLeaseUnavailableError);
		expect(await stat(message.file!)).toBeDefined();
		writer.child.send("release");
		await writer.exited;
	});

	it.skipIf(process.platform === "win32")(
		"uses the same lease through a symlink alias",
		async () => {
			const directory = await temporaryDirectory();
			const aliasRoot = await temporaryDirectory();
			const alias = path.join(aliasRoot, "alias");
			await symlink(directory, alias);
			await withPortraitRenderCacheLock({
				directory,
				run: async () => {
					await expect(
						withPortraitRenderCacheLock({
							directory: alias,
							timeoutMs: 40,
							run: async () => "must not run",
						})
					).rejects.toThrow("lock timed out");
				},
			});
		}
	);

	it("shares the lease across case aliases on case-insensitive filesystems", async ({
		skip,
	}) => {
		const root = await temporaryDirectory();
		const directory = path.join(root, "MixedCache");
		const alias = path.join(root, "mIXEDcACHE");
		await mkdir(directory);
		const aliasIdentity = await stat(alias, { bigint: true }).catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return null;
				throw error;
			}
		);
		if (!aliasIdentity) {
			skip();
			return;
		}
		const identity = await stat(directory, { bigint: true });
		expect(aliasIdentity.dev).toBe(identity.dev);
		expect(aliasIdentity.ino).toBe(identity.ino);
		await withPortraitRenderCacheLock({
			directory,
			run: async () => {
				await expect(
					withPortraitRenderCacheLock({
						directory: alias,
						timeoutMs: 40,
						run: async () => "must not run",
					})
				).rejects.toBeInstanceOf(CacheLeaseUnavailableError);
			},
		});
	});

	it("retains the same lease when its directory is renamed", async () => {
		const root = await temporaryDirectory();
		const directory = path.join(root, "original");
		const renamed = path.join(root, "renamed");
		await withPortraitRenderCacheLock({
			directory,
			run: async () => {
				await rename(directory, renamed);
				await expect(
					withPortraitRenderCacheLock({
						directory: renamed,
						timeoutMs: 40,
						run: async () => "must not run",
					})
				).rejects.toBeInstanceOf(CacheLeaseUnavailableError);
			},
		});
		expect(
			await withPortraitRenderCacheLock({
				directory: renamed,
				run: async () => "released",
			})
		).toBe("released");
	});
});
