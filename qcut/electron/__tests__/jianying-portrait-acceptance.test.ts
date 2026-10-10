// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	planMinuteFrames,
	verifyMinuteMotion,
	rgbaHash,
	openMinuteFrames,
} from "./jianying-portrait-acceptance-fixture";
import {
	faceSpecificity,
	fixedGainDifference,
} from "./jianying-portrait-acceptance-metrics";
import type { JianyingPortraitDetectedFace } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";
import {
	minuteSeekHistory,
	runMinuteSeekAcceptance,
} from "./jianying-portrait-acceptance-seek";
import type { PortraitSessionProvider } from "./jianying-portrait-session-plan";

function metadata() {
	return {
		format: { duration: "104" },
		streams: [{ width: 8, height: 4, sample_aspect_ratio: "1:1" }],
		frames: Array.from({ length: 1801 }, (_, index) => ({
			best_effort_timestamp_time: String(index / 30),
		})),
	};
}

describe("real minute frame evidence", () => {
	it("requires every chronological decoded frame through sixty seconds, not sixty frames", () => {
		const plan = planMinuteFrames({ metadata: metadata() });
		expect(plan.frames).toHaveLength(1801);
		expect(plan.spanSeconds).toBe(60);
		expect(plan.frames.at(-1)).toEqual({ index: 1800, time: 60 });
	});
	it("rejects the 70-frame clip as a minute fixture", () => {
		const value = metadata();
		value.format.duration = "2.333";
		value.frames = value.frames.slice(0, 70);
		expect(() => planMinuteFrames({ metadata: value })).toThrow(
			"shorter than 60"
		);
	});
	it("does not trust container duration instead of decoded coverage", () => {
		const value = metadata();
		value.frames = value.frames.slice(0, 70);
		expect(() => planMinuteFrames({ metadata: value })).toThrow(
			"Decoded frame span"
		);
	});
	it.each([
		"NaN",
		"Infinity",
		"-1",
		"0",
		"9",
	])("rejects nonchronological timestamp %s", (time) => {
		const value = metadata();
		value.frames[1].best_effort_timestamp_time = time;
		expect(() => planMinuteFrames({ metadata: value })).toThrow();
	});
	it("rejects unsupported dimensions, SAR, rotation and excessive inventory", () => {
		for (const stream of [
			{ width: 0, height: 4 },
			{ width: 8000, height: 4000 },
			{ width: 8, height: 4, sample_aspect_ratio: "2:1" },
			{ width: 8, height: 4, side_data_list: [{ rotation: 90 }] },
		]) {
			expect(() =>
				planMinuteFrames({ metadata: { ...metadata(), streams: [stream] } })
			).toThrow();
		}
		expect(() =>
			planMinuteFrames({
				metadata: {
					...metadata(),
					frames: Array(3602).fill({ best_effort_timestamp_time: "0" }),
				},
			})
		).toThrow();
	});
	it("rejects looped short videos and repeated stills even with long timestamps", () => {
		const frames = metadata().frames.map((_, index) => ({
			index,
			time: index / 30,
			sha256: rgbaHash({ bytes: new Uint8Array([index % 70]) }),
		}));
		expect(() => verifyMinuteMotion({ frames })).toThrow("Repeated still/loop");
		expect(() =>
			verifyMinuteMotion({
				frames: frames.map((frame) => ({ ...frame, sha256: "missing" })),
			})
		).toThrow("hash");
	});
	it("reports duplicate source frames without disguising them as motion", () => {
		const frames = Array.from({ length: 70 }, (_, index) => ({
			index,
			time: index,
			sha256: rgbaHash({ bytes: new Uint8Array([Math.min(index, 68)]) }),
		}));
		expect(verifyMinuteMotion({ frames })).toMatchObject({
			uniqueFrames: 69,
			repeatedFrames: 1,
		});
	});
	it("reads exact byte offsets and rejects short reads and invalid frame numbers", async () => {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "portrait-minute-test-")
		);
		const file = path.join(directory, "frames.rgba");
		await writeFile(file, new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]));
		const reader = await openMinuteFrames({
			file,
			plan: {
				width: 1,
				height: 1,
				containerDuration: 60,
				spanSeconds: 60,
				frames: [
					{ index: 0, time: 0 },
					{ index: 1, time: 30 },
					{ index: 2, time: 60 },
				],
			},
		});
		try {
			expect(await reader.read({ index: 1 })).toEqual(
				new Uint8Array([4, 5, 6, 255])
			);
			await expect(reader.read({ index: 2 })).rejects.toThrow("Truncated");
			await expect(reader.read({ index: -1 })).rejects.toThrow("index");
			await expect(reader.read({ index: 0.5 })).rejects.toThrow("index");
		} finally {
			await reader.close();
			await rm(directory, { recursive: true });
		}
	});
});

function twoFaces(): JianyingPortraitDetectedFace[] {
	return [0, 1].map((index) => ({
		trackId: index,
		faceId: index,
		freidTrackId: index,
		personBindingId: `person-${index}`,
		bindingStatus: "new",
		rect: { x: index / 2, y: 0, width: 0.5, height: 1 },
		score: 1,
		yaw: 0,
		pitch: 0,
		roll: 0,
		trackingCount: 0,
		landmarkCount: 106,
	}));
}

describe("multi-face specificity and fixed gain", () => {
	const original = new Uint8Array([20, 30, 40, 255, 20, 30, 40, 255]);
	it("maps asymmetric bottom-left native boxes into top-left RGBA rows", () => {
		const faces = twoFaces();
		faces[0].rect = { x: 0, y: 0.125, width: 0.5, height: 0.25 };
		faces[1].rect = { x: 0.5, y: 0.5, width: 0.5, height: 0.25 };
		const original = new Uint8Array(2 * 8 * 4);
		const actual = new Uint8Array(original);
		const check = () =>
			faceSpecificity({
				actual,
				original,
				faces,
				selectedIds: ["person-0"],
				width: 2,
				height: 8,
			});
		actual[5 * 2 * 4] = 1;
		expect(check().regions.map(({ box }) => box)).toEqual([
			[0, 5, 1, 7],
			[1, 2, 2, 4],
		]);
		expect(check().passed).toBe(true);
		actual[0] = 1;
		expect(check().violations).toContain("outside-face-changed");
		actual[0] = 0;
		actual[(2 * 2 + 1) * 4] = 1;
		expect(check().violations).toContain("unselected-face-changed");
		actual.fill(0);
		actual[1 * 2 * 4] = 1;
		expect(check().violations).toContain("selected-face-no-op");
	});
	it("keeps the native r1 box extent without fitting it to rendered changes", () => {
		const faces = twoFaces();
		faces[0].rect = { x: 0.109722, y: 0.0777778, width: 0.2875, height: 0.55 };
		faces[1].rect = {
			x: 0.659722,
			y: 0.319444,
			width: 0.194444,
			height: 0.369444,
		};
		const original = new Uint8Array(1024 * 512 * 4);
		const result = faceSpecificity({
			actual: original,
			original,
			faces,
			selectedIds: ["person-0"],
			width: 1024,
			height: 512,
		});
		expect(result.regions.map(({ box }) => box)).toEqual([
			[112, 190, 407, 473],
			[675, 159, 875, 349],
		]);
		expect(result.passed).toBe(false);
		expect(result.violations).toContain("selected-face-no-op");
	});
	it("requires selected-face change and exactly zero unselected-face change", () => {
		const actual = new Uint8Array(original);
		actual[0]++;
		expect(
			faceSpecificity({
				actual,
				original,
				faces: twoFaces(),
				selectedIds: ["person-0"],
				width: 2,
				height: 1,
			}).passed
		).toBe(true);
		actual[4]++;
		expect(
			faceSpecificity({
				actual,
				original,
				faces: twoFaces(),
				selectedIds: ["person-0"],
				width: 2,
				height: 1,
			}).violations
		).toContain("unselected-face-changed");
	});
	it("does not pass all-no-op, no-face, unknown, duplicate or overlapping identities", () => {
		expect(
			faceSpecificity({
				actual: original,
				original,
				faces: twoFaces(),
				selectedIds: ["person-0"],
				width: 2,
				height: 1,
			}).passed
		).toBe(false);
		for (const faces of [
			[],
			[twoFaces()[0]],
			[twoFaces()[0], twoFaces()[0]],
			twoFaces().map((face) => ({ ...face, rect: twoFaces()[0].rect })),
		]) {
			expect(() =>
				faceSpecificity({
					actual: original,
					original,
					faces,
					selectedIds: ["person-0"],
					width: 2,
					height: 1,
				})
			).toThrow();
		}
		expect(() =>
			faceSpecificity({
				actual: original,
				original,
				faces: twoFaces(),
				selectedIds: ["unknown"],
				width: 2,
				height: 1,
			})
		).toThrow();
	});
	it("uses fixed x8 RGB gain and exposes alpha corruption separately", () => {
		const actual = new Uint8Array(original);
		actual[0] += 2;
		actual[4] += 50;
		expect(
			fixedGainDifference({ actual, expected: original, width: 2, height: 1 })
		).toEqual(new Uint8Array([16, 16, 16, 255, 255, 255, 255, 255]));
		actual[3] = 0;
		expect(
			faceSpecificity({
				actual,
				original,
				faces: twoFaces(),
				selectedIds: ["person-0", "person-1"],
				width: 2,
				height: 1,
			}).violations
		).toContain("alpha-changed");
	});
});

describe("actual decoded source pre-roll", () => {
	const plan = () => {
		const value = planMinuteFrames({ metadata: metadata() });
		value.frames = value.frames.map((frame) => ({
			...frame,
			sha256: rgbaHash({ bytes: new Uint8Array(128).fill(frame.index % 255) }),
		}));
		return value;
	};
	it("uses only preceding decoded frames within product count/time/byte limits", () => {
		const value = plan();
		const history = minuteSeekHistory({ plan: value, index: 900 });
		expect(history.length).toBeGreaterThan(0);
		expect(history.length).toBeLessThanOrEqual(16);
		expect(
			history.every(
				(frame) =>
					frame.index < 900 && value.frames[900].time - frame.time <= 0.5
			)
		).toBe(true);
		for (const index of [-1, 0, 1801, 0.5])
			expect(() => minuteSeekHistory({ plan: value, index })).toThrow();
	});
	it("exercises seek, pause and source changes with owned cleanup", async () => {
		const providers: PortraitSessionProvider[] = [];
		const createProvider = (): PortraitSessionProvider => {
			const provider: PortraitSessionProvider = {
				clear: vi.fn(async () => undefined),
				render: vi.fn<PortraitSessionProvider["render"]>(
					async ({ width, height, rgba }) => ({
						provider: "jianying-local-swing-v1",
						width,
						height,
						rgba: new Uint8Array(rgba),
						activeGroups: ["face"],
					})
				),
			};
			providers.push(provider);
			return provider;
		};
		const result = await runMinuteSeekAcceptance({
			plan: plan(),
			createProvider,
			readFrame: async ({ index }) => new Uint8Array(128).fill(index % 255),
			onSample: async () => undefined,
		});
		expect(result.passed).toBe(true);
		expect(result.cases).toHaveLength(3);
		expect(providers).toHaveLength(4);
		for (const provider of providers)
			expect(provider.clear).toHaveBeenCalledOnce();
	});
	it("rejects changed history bytes and clears its provider before any native work", async () => {
		const provider: PortraitSessionProvider = {
			clear: vi.fn(async () => undefined),
			render: vi.fn(),
		};
		await expect(
			runMinuteSeekAcceptance({
				plan: plan(),
				createProvider: () => provider,
				readFrame: async () => new Uint8Array(128),
				onSample: async () => undefined,
			})
		).rejects.toThrow("history differs");
		expect(provider.render).not.toHaveBeenCalled();
		expect(provider.clear).toHaveBeenCalledOnce();
	});
});
