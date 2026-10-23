// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoreMLHistoryGuard } from "../beauty-lab/beauty-lab-independent-coreml-history";
import {
	createIndependentSequenceFrameRenderer,
	independentBodyVideoSession,
	pruneIndependentSessions,
} from "../beauty-lab/beauty-lab-independent-body-video";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "coreml-history-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
const session = "a".repeat(64),
	resources = "b".repeat(64);
const execution = {
	profile: "swing-coreml-v1",
	sources: "owned",
	networks: "pinned",
};
function history({ selected = session } = {}) {
	return createCoreMLHistoryGuard({
		sessionsDirectory: directory,
		session: selected,
		resourceIdentitySha256: resources,
		execution,
	});
}
function journal({ selected = session, count = 1 } = {}) {
	return {
		version: 1,
		session: selected,
		identity: { ...execution, generation: selected },
		frames: Array.from({ length: count }, (_, frame) => ({
			frame,
			input: "c".repeat(64),
			routes: [{ network: "refine", backend: "coreml" }],
		})),
	};
}
async function save({ value = journal() } = {}) {
	const folder = path.join(directory, value.session);
	await mkdir(folder, { recursive: true });
	await writeFile(
		path.join(folder, "execution-routes-v1.json"),
		JSON.stringify(value)
	);
}
async function guard({ selected = session } = {}) {
	return JSON.parse(
		await readFile(
			path.join(directory, ".coreml-history", `${selected}.json`),
			"utf8"
		)
	);
}

describe("durable CoreML route prefix", () => {
	it("accepts a new session but refuses orphan cached pixels", async () => {
		await history().synchronize();
		await expect(history().synchronize({ requiredFrame: 0 })).rejects.toThrow(
			"history is missing"
		);
	});
	it("persists the resource/profile/generation binding before publishing pixels", async () => {
		await save();
		await history().synchronize({ requiredFrame: 0 });
		expect(await guard()).toMatchObject({
			session,
			executionGeneration: session,
			profile: "swing-coreml-v1",
			resourceIdentitySha256: resources,
			frames: 1,
			prefixSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		await expect(history().synchronize({ requiredFrame: 1 })).rejects.toThrow(
			"no completed route history"
		);
	});
	it("recovers a journal extended before an interrupted guard update", async () => {
		await save();
		await history().synchronize();
		const before = await guard();
		await save({ value: journal({ count: 3 }) });
		await writeFile(
			path.join(directory, ".coreml-history", `${session}.interrupted.tmp`),
			"partial"
		);
		await history().synchronize({ requiredFrame: 2 });
		expect(await guard()).toMatchObject({ frames: 3 });
		expect((await guard()).prefixSha256).not.toBe(before.prefixSha256);
	});
	it.each([
		"deleted",
		"truncated",
		"rewritten",
	])("refuses %s completed history", async (change) => {
		await save({ value: journal({ count: 2 }) });
		await history().synchronize();
		if (change === "deleted")
			await rm(path.join(directory, session), { recursive: true });
		if (change === "truncated") await save({ value: journal() });
		if (change === "rewritten") {
			const changed = journal({ count: 2 });
			changed.frames[0].input = "d".repeat(64);
			await save({ value: changed });
		}
		await expect(history().synchronize()).rejects.toThrow(
			/missing|truncated or rewritten/
		);
		expect((await guard()).frames).toBe(2);
	});
	it("refuses a changed model/source identity even with the same session name", async () => {
		await save();
		await history().synchronize();
		const changed = createCoreMLHistoryGuard({
			sessionsDirectory: directory,
			session,
			execution,
			resourceIdentitySha256: "d".repeat(64),
		});
		await expect(changed.synchronize()).rejects.toThrow(
			"guard identity mismatch"
		);
	});
	it("checks actual execution identity and route order", async () => {
		const changed = journal();
		changed.identity.sources = "different";
		await save({ value: changed });
		await expect(history().synchronize()).rejects.toThrow(
			"execution identity mismatch"
		);
		const invalid = journal({ count: 2 });
		invalid.frames[1].routes[0].backend = "cpu";
		await save({ value: invalid });
		await expect(history().synchronize()).rejects.toThrow(
			"CPU after activation"
		);
	});
	it("serializes concurrent guard advancement and retains the longest prefix", async () => {
		await save({ value: journal({ count: 4 }) });
		await Promise.all(
			Array.from({ length: 8 }, () =>
				history().synchronize({ requiredFrame: 3 })
			)
		);
		expect((await guard()).frames).toBe(4);
		await save({ value: journal({ count: 6 }) });
		await Promise.all([
			history().synchronize({ requiredFrame: 1 }),
			history().synchronize({ requiredFrame: 5 }),
		]);
		expect((await guard()).frames).toBe(6);
	});
	it("preserves route journals and guards while reclaiming all snapshots", async () => {
		await save();
		await history().synchronize();
		const before = await guard();
		await writeFile(
			path.join(directory, session, "0000000012.snapshot"),
			new Uint8Array(2048)
		);
		await pruneIndependentSessions({ directory, maxBytes: 0 });
		await history().synchronize({ requiredFrame: 0 });
		expect(await guard()).toEqual(before);
	});
});

describe("CoreML cache/history integration", () => {
	function renderer() {
		const request = {
			requestId: "first",
			width: 1,
			height: 1,
			rgba: new Uint8Array([1, 2, 3, 255]),
			adjustments: {
				enabled: true as const,
				values: { body_adjust_SlimBody: 25 },
				bodyVideoProfile: "swing-coreml-v1" as const,
			},
			sequence: {
				clip: "c".repeat(64),
				frame: 0,
				fps: 24,
				replay: false,
				sourceTimestampSeconds: 0,
			},
		};
		const selected = independentBodyVideoSession({
			engineSha256: resources,
			clip: request.sequence.clip,
			width: 1,
			height: 1,
			execution: { profile: "swing-coreml-v1", fps: 24 },
		});
		const cache = {
			read: vi.fn(async () => request.rgba as Uint8Array | null),
			write: vi.fn(async () => {}),
		};
		const provider = {
			render: vi.fn(
				async () =>
					({
						...request,
						png: new Uint8Array(),
					}) as unknown as BeautyLabIndependentResult
			),
		};
		const frames = createIndependentSequenceFrameRenderer({
			provider,
			cache,
			sessionsDirectory: directory,
			engineSha256: async () => resources,
			resolveCoreML: async () => ({
				engineSha256: resources,
				identitySha256: resources,
				execution,
			}),
		});
		return { request, selected, cache, provider, frames };
	}
	it("blocks the cache before lookup when a completed journal was deleted", async () => {
		const test = renderer();
		await save({ value: journal({ selected: test.selected }) });
		await history({ selected: test.selected }).synchronize();
		await rm(path.join(directory, test.selected), { recursive: true });
		await expect(test.frames.render({ request: test.request })).rejects.toThrow(
			"history is missing"
		);
		expect(test.cache.read).not.toHaveBeenCalled();
		expect(test.provider.render).not.toHaveBeenCalled();
	});
	it("refuses an orphan cache hit even when its guard is also absent", async () => {
		const test = renderer();
		await expect(test.frames.render({ request: test.request })).rejects.toThrow(
			"history is missing"
		);
		expect(test.provider.render).not.toHaveBeenCalled();
	});
	it("allows a guarded cache hit after checkpoint eviction without rerunning inference", async () => {
		const test = renderer();
		await save({ value: journal({ selected: test.selected }) });
		await writeFile(
			path.join(directory, test.selected, "0000000012.snapshot"),
			new Uint8Array(2048)
		);
		await pruneIndependentSessions({ directory, maxBytes: 0 });
		expect(await test.frames.render({ request: test.request })).toMatchObject({
			cached: true,
		});
		expect((await guard({ selected: test.selected })).frames).toBe(1);
		expect(test.provider.render).not.toHaveBeenCalled();
	});
	it("does not publish a computed frame lacking its completed journal", async () => {
		const test = renderer();
		test.cache.read.mockResolvedValue(null);
		await expect(test.frames.render({ request: test.request })).rejects.toThrow(
			"history is missing"
		);
		expect(test.provider.render).toHaveBeenCalledOnce();
		expect(test.cache.write).not.toHaveBeenCalled();
	});
});
