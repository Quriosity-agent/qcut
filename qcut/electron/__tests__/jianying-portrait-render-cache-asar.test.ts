// @vitest-environment node
import { execFile } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPackageWithOptions, uncache } from "@electron/asar";
import electron from "electron";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const directories: string[] = [];
const runtimeDirectory = fileURLToPath(
	new URL("../jianying-portrait-adjustment-runtime/", import.meta.url)
);
const workerSource = fileURLToPath(
	new URL("./fixtures/portrait-render-cache-asar.cjs", import.meta.url)
);
let compiledDirectory: string;
let runtimeBundle: string;

type CacheReport = {
	electronVersion: string;
	virtualInodeChanged: boolean;
	identity: string;
	hits: boolean[];
	nativeCalls: number;
	cacheApplications: number;
	files: string[];
	missingRejected?: boolean;
	ordinaryDirectoryMutationDetected?: boolean;
	archiveMutationRejected?: boolean;
	linkedUnpackedMutationDetected?: boolean;
};

beforeAll(async () => {
	compiledDirectory = await mkdtemp(
		path.join(os.tmpdir(), "portrait-asar-code-")
	);
	runtimeBundle = path.join(compiledDirectory, "runtime.cjs");
	await build({
		stdin: {
			contents: [
				'export { createPortraitRuntimeFingerprinter } from "./render-cache-identity.ts";',
				'export { createPortraitRenderDiskCache } from "./render-disk-cache.ts";',
				'export { createPortraitSourceWindowRenderCache } from "./source-window-render-cache.ts";',
			].join("\n"),
			resolveDir: runtimeDirectory,
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		external: ["electron", "original-fs"],
		outfile: runtimeBundle,
	});
});

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

afterAll(async () => {
	if (compiledDirectory)
		await rm(compiledDirectory, { recursive: true, force: true });
});

async function fixture({ archiveName = "app.asar" } = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), "portrait-asar-cache-"));
	directories.push(root);
	const source = path.join(root, "source");
	const archive = path.join(root, archiveName);
	const cacheDirectory = path.join(root, "cache");
	await mkdir(path.join(source, "assets"), { recursive: true });
	await Promise.all([
		copyFile(workerSource, path.join(source, "worker.cjs")),
		copyFile(runtimeBundle, path.join(source, "runtime.cjs")),
		writeFile(path.join(source, "assets/packed.txt"), "packed-v1"),
		writeFile(path.join(source, "assets/unpacked.txt"), "unpacked-v1"),
	]);
	async function pack() {
		uncache(archive);
		await createPackageWithOptions(source, archive, {
			unpack: "**/unpacked.txt",
		});
	}
	await pack();
	async function run({
		mode = "cache",
		options = {},
	}: {
		mode?: string;
		options?: Record<string, string>;
	} = {}): Promise<CacheReport> {
		const executable: unknown = electron;
		if (typeof executable !== "string")
			throw new Error("Electron package must expose its executable path");
		const { stdout } = await execute(
			executable,
			[
				path.join(archive, "worker.cjs"),
				mode,
				JSON.stringify({ cacheDirectory, ...options }),
			],
			{
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
				timeout: 20_000,
				maxBuffer: 1024 * 1024,
			}
		);
		return JSON.parse(stdout) as CacheReport;
	}
	return { root, source, archive, pack, run };
}

describe("native frame cache in real Electron ASAR", () => {
	it("writes cold frames and reuses them within and across Electron processes", async () => {
		const f = await fixture();
		const cold = await f.run();
		expect(cold.virtualInodeChanged).toBe(true);
		expect(cold.electronVersion).toMatch(/^\d+\./);
		expect(cold.hits).toEqual([false, true]);
		expect(cold.nativeCalls).toBe(1);
		expect(cold.cacheApplications).toBe(1);
		expect(cold.files).toHaveLength(1);
		const warm = await f.run();
		expect(warm.identity).toBe(cold.identity);
		expect(warm.hits).toEqual([true, true]);
		expect(warm.nativeCalls).toBe(0);
		expect(warm.cacheApplications).toBe(2);
		expect(warm.files).toEqual(cold.files);
	}, 30_000);

	it("invalidates packed contents after the archive is rebuilt at the same path", async () => {
		const f = await fixture();
		const before = await f.run();
		await writeFile(path.join(f.source, "assets/packed.txt"), "packed-v2");
		await f.pack();
		const after = await f.run();
		expect(after.identity).not.toBe(before.identity);
		expect(after.hits).toEqual([false, true]);
		expect(after.nativeCalls).toBe(1);
		expect(after.files).toHaveLength(2);
	}, 30_000);

	it("handles Electron's case-insensitive ASAR extension", async () => {
		const f = await fixture({ archiveName: "app.ASAR" });
		const result = await f.run();
		expect(result.hits).toEqual([false, true]);
		expect(result.nativeCalls).toBe(1);
		expect(result.files).toHaveLength(1);
	});

	it("invalidates unpacked backing files with the same fingerprinter instance", async () => {
		const f = await fixture();
		const result = await f.run({ mode: "unpacked-mutation" });
		expect(result.hits).toEqual([false, true, false, true]);
		expect(result.nativeCalls).toBe(2);
		expect(result.cacheApplications).toBe(2);
		expect(result.files).toHaveLength(2);
	}, 30_000);

	it("tracks unpacked symlink targets outside the requested ASAR directory", async () => {
		const f = await fixture();
		await mkdir(path.join(f.source, "shared"));
		await writeFile(path.join(f.source, "shared/unpacked.txt"), "shared-v1");
		await symlink(
			"../shared/unpacked.txt",
			path.join(f.source, "assets/alias")
		);
		await f.pack();
		expect(await f.run({ mode: "linked-unpacked" })).toMatchObject({
			linkedUnpackedMutationDetected: true,
		});
	});

	it.each([
		"assets/absent.txt",
		"missing-directory/model.txt",
	])("rejects a missing member %s even though the ASAR archive exists", async (relativePath) => {
		const f = await fixture();
		expect(
			await f.run({ mode: "missing", options: { relativePath } })
		).toMatchObject({ missingRejected: true });
	});

	it("rejects missing unpacked backing rather than accepting archive identity alone", async () => {
		const f = await fixture();
		await rm(path.join(`${f.archive}.unpacked`, "assets/unpacked.txt"));
		expect(
			await f.run({
				mode: "missing",
				options: { relativePath: "assets/unpacked.txt" },
			})
		).toMatchObject({ missingRejected: true });
	});

	it.each([
		"assets/unpacked.txt",
		".",
	])("rejects missing unpacked %s while fingerprinting the archive directory", async (relativePath) => {
		const f = await fixture();
		await rm(path.join(`${f.archive}.unpacked`, relativePath), {
			recursive: true,
		});
		expect(
			await f.run({ mode: "missing", options: { relativePath: "." } })
		).toMatchObject({ missingRejected: true });
	});

	it("rejects an archive changed during its physical content scan", async () => {
		const f = await fixture();
		expect(await f.run({ mode: "archive-mutation" })).toMatchObject({
			archiveMutationRejected: true,
		});
	});

	it("handles a real directory named .asar with normal file invalidation", async () => {
		const f = await fixture();
		const directory = path.join(f.root, "ordinary.asar");
		await mkdir(directory);
		await writeFile(path.join(directory, "model.txt"), "old-model");
		expect(
			await f.run({ mode: "ordinary-directory", options: { directory } })
		).toMatchObject({ ordinaryDirectoryMutationDetected: true });
	});
});
