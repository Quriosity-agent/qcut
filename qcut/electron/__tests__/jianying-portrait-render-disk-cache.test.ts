// @vitest-environment node
import { randomBytes } from "node:crypto";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPortraitRenderDiskCache } from "../jianying-portrait-adjustment-runtime/render-disk-cache.js";
import type { JianyingPortraitAdjustmentRenderResult } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});
async function fixture({ maxBytes = 1024 * 1024 }: { maxBytes?: number } = {}) {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "native-frame-cache-")
	);
	directories.push(directory);
	return {
		directory,
		cache: createPortraitRenderDiskCache({ directory, maxBytes }),
	};
}
function output(): JianyingPortraitAdjustmentRenderResult {
	return {
		provider: "jianying-local-swing-v1",
		width: 16,
		height: 16,
		rgba: randomBytes(1024),
		activeGroups: ["body"],
	};
}
const key = "a".repeat(64);
const read = ({
	cache,
	signal,
	cacheKey = key,
}: {
	cache: ReturnType<typeof createPortraitRenderDiskCache>;
	signal?: AbortSignal;
	cacheKey?: string;
}) => cache.read({ key: cacheKey, width: 16, height: 16, signal });

describe("native render disk cache", () => {
	it("round-trips lossless pixels and returns separate owned output buffers", async () => {
		const { cache } = await fixture();
		const result = output();
		await cache.write({ key, result });
		const first = await read({ cache });
		expect(first).toEqual({ ...result, rgba: new Uint8Array(result.rgba) });
		first!.rgba.fill(0);
		expect((await read({ cache }))!.rgba).toEqual(new Uint8Array(result.rgba));
		await cache.close();
	});
	it.each([
		"truncate",
		"payload",
		"identity",
	] as const)("rejects %s corruption and removes the entry", async (kind) => {
		const { directory, cache } = await fixture();
		await cache.write({ key, result: output() });
		const file = path.join(directory, `${key}.frame`);
		const bytes = await readFile(file);
		if (kind === "truncate") await writeFile(file, bytes.subarray(0, 20));
		if (kind === "payload") {
			bytes[bytes.length - 10] ^= 128;
			await writeFile(file, bytes);
		}
		if (kind === "identity") {
			bytes[12] ^= 1;
			await writeFile(file, bytes);
		}
		expect(await read({ cache })).toBeNull();
		expect(await readdir(directory)).toEqual([]);
		await cache.close();
	});
	it("rejects dimension mismatches before returning pixels", async () => {
		const { cache } = await fixture();
		await cache.write({ key, result: output() });
		expect(await cache.read({ key, width: 8, height: 32 })).toBeNull();
		await cache.close();
	});
	it("evicts to the disk budget and leaves no temporary files after close", async () => {
		const { directory, cache } = await fixture({ maxBytes: 1600 });
		await cache.write({ key, result: output() });
		const next = "b".repeat(64);
		const pending = cache.write({ key: next, result: output() });
		await cache.close();
		await pending;
		const files = await readdir(directory);
		expect(files).toEqual([`${next}.frame`]);
		expect(
			(await stat(path.join(directory, files[0]))).size
		).toBeLessThanOrEqual(1600);
		await expect(read({ cache })).rejects.toThrow("closed");
	});
	it("does not cache oversized or unfinished renders", async () => {
		const { directory, cache } = await fixture({ maxBytes: 10 });
		await cache.write({ key, result: output() });
		await cache.write({
			key,
			result: { ...output(), needsSourcePreRoll: true },
		});
		expect(await readdir(directory)).toEqual([]);
		await cache.close();
	});
	it("prunes an oversized pre-existing cache on the first read", async () => {
		const { directory, cache } = await fixture();
		const newestKey = "b".repeat(64);
		const newest = output();
		await cache.write({ key, result: output() });
		await cache.write({ key: newestKey, result: newest });
		await cache.close();
		expect((await readdir(directory)).length).toBe(2);
		const smallerCache = createPortraitRenderDiskCache({
			directory,
			maxBytes: 1600,
		});
		expect(
			(await read({ cache: smallerCache, cacheKey: newestKey }))!.rgba
		).toEqual(new Uint8Array(newest.rgba));
		const sizes = await Promise.all(
			(await readdir(directory)).map(
				async (file) => (await stat(path.join(directory, file))).size
			)
		);
		expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(
			1600
		);
		await smallerCache.close();
	});
	it("replaces an existing key by evicting it when temporary bytes need the budget", async () => {
		const { directory, cache } = await fixture({ maxBytes: 1600 });
		await cache.write({ key, result: output() });
		const replacement = output();
		await cache.write({ key, result: replacement });
		expect((await read({ cache }))!.rgba).toEqual(
			new Uint8Array(replacement.rgba)
		);
		expect(await readdir(directory)).toEqual([`${key}.frame`]);
		await cache.close();
	});
	it("aborted cache hits reject without deleting valid pixels", async () => {
		const { cache } = await fixture();
		const result = output();
		await cache.write({ key, result });
		const controller = new AbortController();
		const pending = read({ cache, signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect((await read({ cache }))!.rgba).toEqual(new Uint8Array(result.rgba));
		await cache.close();
	});
});
