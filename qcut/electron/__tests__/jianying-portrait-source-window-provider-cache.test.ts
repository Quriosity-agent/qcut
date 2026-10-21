// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JianyingPortraitAdjustmentRenderRequest } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import type { JianyingPortraitHostRenderCommand } from "../jianying-portrait-adjustment-runtime/host-process.js";

const mocks = vi.hoisted(() => ({ start: vi.fn(), identity: "runtime-v1" }));
vi.mock("../jianying-portrait-adjustment-runtime/host-process.js", () => ({
	startJianyingPortraitHostProcess: mocks.start,
}));
vi.mock(
	"../jianying-portrait-adjustment-runtime/render-cache-identity.js",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../jianying-portrait-adjustment-runtime/render-cache-identity.js")
		>()),
		createPortraitRenderIdentity: () => ({
			resolve: async () => mocks.identity,
			clear: () => {},
		}),
		resolvePortraitRenderRuntime: async () => [
			{
				status: { state: "ready" },
				frameworkDirectory: "/runtime/Frameworks",
				modelDirectory: "/models",
			},
			"/host",
			[
				{
					group: "body",
					runtimePackage: "body",
					packagePath: "/packages/body",
					source: "qcut-private",
				},
			],
			[],
		],
	})
);
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider.js";

function request(): JianyingPortraitAdjustmentRenderRequest {
	return {
		width: 1,
		height: 1,
		rgba: new Uint8Array([80, 90, 100, 255]),
		sourceKey: "source-window-v1:clip",
		timestampSeconds: 1.2,
		freshTracking: true,
		adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
		sourcePreRoll: {
			sourceKey: "source-window-v1:clip",
			frames: [
				{ timestampSeconds: 1, rgba: new Uint8Array([10, 20, 30, 255]) },
				{ timestampSeconds: 1.1, rgba: new Uint8Array([40, 50, 60, 255]) },
			],
		},
	};
}

describe("native provider complete source-window cache", () => {
	let provider: ReturnType<typeof createJianyingPortraitAdjustmentProvider>;
	let directory: string;
	let commands: Array<{ time: number; input: number[] }>;
	let waitForRender: (() => Promise<void>) | undefined;
	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.identity = "runtime-v1";
		commands = [];
		waitForRender = undefined;
		directory = await mkdtemp(path.join(os.tmpdir(), "native-provider-cache-"));
		vi.stubEnv("QCUT_JIANYING_PORTRAIT_RENDER_CACHE_ROOT", directory);
		mocks.start.mockImplementation(async () => {
			let history = 0;
			return {
				dispose: vi.fn(async () => {}),
				detect: vi.fn(),
				stroke: vi.fn(),
				render: async ({
					inputPath,
					outputPath,
					timestampSeconds,
				}: JianyingPortraitHostRenderCommand) => {
					const input = await readFile(inputPath);
					commands.push({ time: timestampSeconds, input: [...input] });
					await waitForRender?.();
					history += input[0] === 10 ? 2 : 1;
					input[1] += history;
					await writeFile(outputPath, input);
				},
			};
		});
		provider = createJianyingPortraitAdjustmentProvider();
	});
	afterEach(async () => {
		await provider.clear();
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	});
	it("cold and duplicate queued requests produce identical pixels with one unchanged replay", async () => {
		const [first, duplicate] = await Promise.all([
			provider.render({ ...request(), requestId: "first" }),
			provider.render({ ...request(), requestId: "duplicate" }),
		]);
		expect(commands.map(({ time }) => time)).toEqual([1, 1.1, 1.2]);
		expect(mocks.start).toHaveBeenCalledOnce();
		expect(first.sourceWindowCacheHit).toBe(false);
		expect(duplicate.sourceWindowCacheHit).toBe(true);
		expect(first.nativeRenderCount).toBe(3);
		expect(duplicate.nativeRenderCount).toBe(0);
		expect(duplicate.rgba).toEqual(first.rgba);
		expect(first.rgba).toEqual(new Uint8Array([80, 94, 100, 255]));
	});
	it("different pre-roll pixels and runtime content cannot hit the previous result", async () => {
		const first = await provider.render(request());
		const changed = request();
		changed.sourcePreRoll!.frames[0].rgba[0] = 11;
		const second = await provider.render(changed);
		expect(second.rgba).not.toEqual(first.rgba);
		expect(commands).toHaveLength(6);
		mocks.identity = "runtime-v2";
		expect((await provider.render(request())).rgba).toEqual(first.rgba);
		expect(commands).toHaveLength(9);
	});
	it("cancelled active replay finishes its original history and suppresses the queued request", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		waitForRender = () => gate;
		const active = provider.render({ ...request(), requestId: "active" });
		await vi.waitFor(() => expect(commands).toHaveLength(1));
		const queued = provider.render({ ...request(), requestId: "queued" });
		const activeRejected = expect(active).rejects.toMatchObject({
			name: "AbortError",
		});
		const queuedRejected = expect(queued).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(provider.cancel({ requestId: "active" })).toBe(true);
		expect(provider.cancel({ requestId: "queued" })).toBe(true);
		await Promise.all([activeRejected, queuedRejected]);
		release();
		const hit = await provider.render(request());
		expect(commands.map(({ time }) => time)).toEqual([1, 1.1, 1.2]);
		expect(hit.sourceWindowCacheHit).toBe(true);
		expect(hit.nativeRenderCount).toBe(0);
		expect(hit.rgba).toEqual(new Uint8Array([80, 94, 100, 255]));
	});
	it("copies mutable inputs before waiting in the queue", async () => {
		const original = request();
		const pending = provider.render(original);
		original.rgba.fill(0);
		original.adjustments.values.body_adjust_SlimBody = 90;
		original.sourcePreRoll!.frames[0].rgba.fill(0);
		const result = await pending;
		expect(commands[0].input).toEqual([10, 20, 30, 255]);
		expect(commands[2].input).toEqual([80, 90, 100, 255]);
		expect(result.rgba).toEqual(new Uint8Array([80, 94, 100, 255]));
	});
	it("restores the original native history before a cached scope resumes continuous rendering", async () => {
		const next = {
			...request(),
			freshTracking: false,
			sourcePreRoll: undefined,
			timestampSeconds: 1.25,
			rgba: new Uint8Array([90, 100, 110, 255]),
		};
		const later = {
			...next,
			timestampSeconds: 1.3,
			rgba: new Uint8Array([91, 110, 120, 255]),
		};
		await provider.render(request());
		const baseline = await provider.render(next);
		const baselineLater = await provider.render(later);
		await provider.clear();
		const cached = await provider.render(request());
		expect(cached.sourceWindowCacheHit).toBe(true);
		expect(cached.nativeRenderCount).toBe(0);
		const resumed = await provider.render(next);
		const resumedLater = await provider.render(later);
		expect(resumed.rgba).toEqual(baseline.rgba);
		expect(resumedLater.rgba).toEqual(baselineLater.rgba);
		expect(baseline.nativeRenderCount).toBe(1);
		expect(resumed.nativeRenderCount).toBe(4);
		expect(resumedLater.nativeRenderCount).toBe(1);
	});
	it("preserves tracker and legacy frame-cache eviction when a hot source window follows four continuous scopes", async () => {
		await provider.render(request());
		const continuous = ({
			sourceKey,
			timestampSeconds = 1,
		}: {
			sourceKey: string;
			timestampSeconds?: number;
		}) => ({
			...request(),
			sourceKey,
			sourcePreRoll: undefined,
			freshTracking: false,
			timestampSeconds,
		});
		const exercise = async ({ warm }: { warm: boolean }) => {
			await provider.clear();
			mocks.identity = warm ? "runtime-v1" : "runtime-cold-reference";
			await [
				"continuous-A",
				"continuous-B",
				"continuous-C",
				"continuous-D",
			].reduce(async (previous, sourceKey) => {
				await previous;
				await provider.render(continuous({ sourceKey }));
			}, Promise.resolve());
			const sourceWindow = await provider.render(request());
			const same = await provider.render(
				continuous({ sourceKey: "continuous-A" })
			);
			const later = await provider.render(
				continuous({ sourceKey: "continuous-A", timestampSeconds: 1.1 })
			);
			return { sourceWindow, same, later };
		};
		const cold = await exercise({ warm: false });
		const warm = await exercise({ warm: true });
		expect(cold.sourceWindow.sourceWindowCacheHit).toBe(false);
		expect(warm.sourceWindow.sourceWindowCacheHit).toBe(true);
		expect(warm.sourceWindow.nativeRenderCount).toBe(0);
		expect(cold.same.nativeRenderCount).toBe(1);
		expect(warm.same.nativeRenderCount).toBe(1);
		expect(warm.same.rgba).toEqual(cold.same.rgba);
		expect(warm.later.rgba).toEqual(cold.later.rgba);
	});
	it("does not retain or replay the history of an evicted cached scope", async () => {
		await provider.render(request());
		await provider.clear();
		const cached = await provider.render(request());
		expect(cached.sourceWindowCacheHit).toBe(true);
		await ["A", "B", "C", "D"].reduce(async (previous, sourceKey) => {
			await previous;
			await provider.render({
				...request(),
				sourceKey,
				sourcePreRoll: undefined,
				freshTracking: false,
			});
		}, Promise.resolve());
		const resumed = await provider.render({
			...request(),
			sourcePreRoll: undefined,
			freshTracking: false,
			timestampSeconds: 1.3,
		});
		expect(resumed.nativeRenderCount).toBe(1);
		expect(resumed.rgba).toEqual(new Uint8Array([80, 91, 100, 255]));
	});
	it("keeps cached return buffers separate from legacy cache ownership", async () => {
		await provider.render(request());
		await provider.clear();
		const cached = await provider.render(request());
		cached.rgba.fill(0);
		const sameFrame = await provider.render({
			...request(),
			sourcePreRoll: undefined,
			freshTracking: false,
		});
		expect(sameFrame.rgba).toEqual(new Uint8Array([80, 94, 100, 255]));
	});
	it("refuses to reconstruct cached native state with a changed runtime", async () => {
		await provider.render(request());
		await provider.clear();
		await provider.render(request());
		const count = commands.length;
		mocks.identity = "changed-after-cache-hit";
		await expect(
			provider.render({
				...request(),
				sourcePreRoll: undefined,
				freshTracking: false,
				timestampSeconds: 1.25,
			})
		).rejects.toThrow("Native runtime changed before restoring");
		expect(commands).toHaveLength(count);
	});
});
