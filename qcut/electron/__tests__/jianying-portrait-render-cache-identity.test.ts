// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createPortraitRuntimeFingerprinter,
	isCacheablePortraitSourceWindow,
	portraitSourceWindowCacheKey,
} from "../jianying-portrait-adjustment-runtime/render-cache-identity.js";
import type { JianyingPortraitAdjustmentRenderRequest } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});
function request(): JianyingPortraitAdjustmentRenderRequest {
	return {
		width: 1,
		height: 1,
		rgba: new Uint8Array([1, 2, 3, 255]),
		sourceKey: "source-window-v1:clip",
		timestampSeconds: 1,
		frameNumber: 30,
		freshTracking: true,
		adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
		sourcePreRoll: {
			sourceKey: "source-window-v1:clip",
			frames: [
				{ timestampSeconds: 0.9, rgba: new Uint8Array([4, 5, 6, 255]) },
				{ timestampSeconds: 0.95, rgba: new Uint8Array([7, 8, 9, 255]) },
			],
		},
	};
}
const key = ({
	value,
	runtimeIdentity = "engine-A",
}: {
	value: JianyingPortraitAdjustmentRenderRequest;
	runtimeIdentity?: string;
}) => portraitSourceWindowCacheKey({ request: value, runtimeIdentity });

describe("native source-window render identity", () => {
	it("only permits independently reset global source windows", () => {
		expect(isCacheablePortraitSourceWindow({ request: request() })).toBe(true);
		for (const value of [
			{ ...request(), freshTracking: false },
			{ ...request(), sourceKey: "continuous-clip" },
			{ ...request(), timestampSeconds: undefined },
			{
				...request(),
				adjustments: { ...request().adjustments, enabled: false },
			},
			{
				...request(),
				adjustments: {
					...request().adjustments,
					faceTarget: { mode: "single" as const, faceId: 1 },
				},
			},
			{
				...request(),
				adjustments: {
					...request().adjustments,
					faces: [{ trackId: 1, values: {} }],
				},
			},
		])
			expect(isCacheablePortraitSourceWindow({ request: value })).toBe(false);
	});
	it.each([
		[
			"input",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.rgba[0]++;
			},
		],
		[
			"history pixels",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.sourcePreRoll!.frames[0].rgba[0]++;
			},
		],
		[
			"history time",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.sourcePreRoll!.frames[0].timestampSeconds = 0.89;
			},
		],
		[
			"history order",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.sourcePreRoll!.frames.reverse();
			},
		],
		[
			"empty history",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.sourcePreRoll = undefined;
			},
		],
		[
			"time",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.timestampSeconds = 1.1;
			},
		],
		[
			"frame",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.frameNumber = 31;
			},
		],
		[
			"source",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.sourceKey += "2";
			},
		],
		[
			"adjustment",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.adjustments.values.body_adjust_SlimBody = 55;
			},
		],
		[
			"manual",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.adjustments.manualBody = {
					stretch: { intensity: 20, upper: 0.8, bottom: 0.2 },
				};
			},
		],
		[
			"makeup",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.adjustments.makeup = {
					lip: { cardId: "lip-soft-pink", intensity: 50 },
				};
			},
		],
		[
			"skin tone",
			(v: JianyingPortraitAdjustmentRenderRequest) => {
				v.adjustments.skinToneResourceId = null;
			},
		],
	])("distinguishes %s", (_label, change) => {
		const value = request();
		const before = key({ value });
		change(value);
		expect(key({ value })).not.toBe(before);
	});
	it("keys runtime revisions but excludes request IDs and object insertion order", () => {
		const value = request();
		expect(key({ value, runtimeIdentity: "engine-B" })).not.toBe(
			key({ value })
		);
		const reordered = {
			...value,
			requestId: "other",
			adjustments: { values: value.adjustments.values, enabled: true },
		};
		expect(key({ value: reordered })).toBe(key({ value }));
	});
	it("detects edited, added and removed model files and profile changes", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "native-identity-"));
		directories.push(root);
		await mkdir(path.join(root, "Models"));
		const model = path.join(root, "Models", "a.model");
		await writeFile(model, "first");
		const identity = createPortraitRuntimeFingerprinter();
		const read = (configuration = { backend: "default" }) =>
			identity.fingerprint({ paths: [root], configuration });
		const first = await read();
		expect(await read()).toBe(first);
		await writeFile(model, "other");
		const changed = await read();
		expect(changed).not.toBe(first);
		await writeFile(path.join(root, "Models", "b.model"), "second");
		expect(await read()).not.toBe(changed);
		await rm(path.join(root, "Models", "b.model"));
		expect(await read()).toBe(changed);
		expect(await read({ backend: "cpu" })).not.toBe(changed);
	});
	it("follows symlink targets and stops aborted scans", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "native-identity-"));
		directories.push(root);
		await writeFile(path.join(root, "model"), "v1");
		await symlink(path.join(root, "model"), path.join(root, "alias"));
		const identity = createPortraitRuntimeFingerprinter();
		const first = await identity.fingerprint({
			paths: [path.join(root, "alias")],
			configuration: {},
		});
		await writeFile(path.join(root, "model"), "v2");
		expect(
			await identity.fingerprint({
				paths: [path.join(root, "alias")],
				configuration: {},
			})
		).not.toBe(first);
		const controller = new AbortController();
		controller.abort();
		await expect(
			identity.fingerprint({
				paths: [root],
				configuration: {},
				signal: controller.signal,
			})
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
