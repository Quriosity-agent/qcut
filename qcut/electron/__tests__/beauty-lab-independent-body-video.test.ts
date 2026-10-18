// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";
import {
	createIndependentSequenceFrameRenderer,
	INDEPENDENT_BODY_VIDEO_POLICY,
	independentBodyVideoAvailable,
	independentBodyVideoSession,
	IndependentSequenceGapError,
} from "../beauty-lab/beauty-lab-independent-body-video";
import { createIndependentFrameCache } from "../beauty-lab/beauty-lab-independent-frame-cache";
import { INDEPENDENT_TIMELINE_SOURCE_KEY } from "../beauty-lab/beauty-lab-independent-frames";

const ENGINE_ROOT = path.resolve(
	__dirname,
	"../../research/independent-beauty"
);

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "independent-body-video-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function png({ rgba, width }: { rgba: Uint8Array; width: number }) {
	const height = rgba.length / 4 / width;
	const canvas = createCanvas(width, height);
	canvas
		.getContext("2d")
		.putImageData(
			new ImageData(new Uint8ClampedArray(rgba), width, height),
			0,
			0
		);
	return new Uint8Array(canvas.toBuffer("image/png"));
}

const input = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
const output = new Uint8Array([90, 80, 70, 255, 60, 50, 40, 255]);
const clip = "c".repeat(64);
const request = {
	requestId: "frame-1",
	width: 2,
	height: 1,
	rgba: input,
	adjustments: {
		enabled: true as const,
		values: { body_adjust_SlimBody: 40, body_adjust_SmallHead: 20 },
	},
	sequence: { clip, frame: 0, fps: 24, replay: false },
};

function engine() {
	return {
		render: vi.fn(
			async ({ request: sent }: { request: unknown }) =>
				({
					requestId: (sent as { requestId: string }).requestId,
					width: 2,
					height: 1,
					rgba: output,
					png: png({ rgba: output, width: 2 }),
				}) as BeautyLabIndependentResult
		),
	};
}

function renderer({ provider = engine() } = {}) {
	return {
		provider,
		renderer: createIndependentSequenceFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "e".repeat(64),
			sessionsDirectory: path.join(directory, "sessions"),
		}),
	};
}

describe("body video session identity", () => {
	const base = {
		engineSha256: "e".repeat(64),
		clip,
		width: 1080,
		height: 1920,
	};
	it("changes with the engine, the clip and the frame size", () => {
		const session = independentBodyVideoSession(base);
		expect(session).toMatch(/^[a-f0-9]{64}$/);
		expect(independentBodyVideoSession({ ...base })).toBe(session);
		for (const change of [
			{ engineSha256: "f".repeat(64) },
			{ clip: "d".repeat(64) },
			{ width: 1079 },
			{ height: 1921 },
		])
			expect(independentBodyVideoSession({ ...base, ...change })).not.toBe(
				session
			);
	});
});

describe("body video capability", () => {
	it("needs the pinned policy file in the runtime", async () => {
		expect(
			await independentBodyVideoAvailable({ runtimeRoot: directory })
		).toBe(false);
		await mkdir(path.join(directory, "research"), { recursive: true });
		await writeFile(
			path.join(directory, INDEPENDENT_BODY_VIDEO_POLICY.file),
			"{}"
		);
		expect(
			await independentBodyVideoAvailable({ runtimeRoot: directory })
		).toBe(false);
	});
	it("pins the same file and hash as the engine's video face policy", async () => {
		const source = await readFile(
			path.join(ENGINE_ROOT, "research/body_face_policy.py"),
			"utf8"
		);
		expect(source).toContain(
			`POLICY_FILENAME = '${path.basename(INDEPENDENT_BODY_VIDEO_POLICY.file)}'`
		);
		expect(source).toContain(
			`POLICY_SHA256 = '${INDEPENDENT_BODY_VIDEO_POLICY.sha256}'`
		);
		expect(path.dirname(INDEPENDENT_BODY_VIDEO_POLICY.file)).toBe("research");
	});
	it("reports the local private runtime when its policy is installed", async () => {
		const runtimeRoot = path.join(ENGINE_ROOT, "runtime");
		const installed = await readFile(
			path.join(runtimeRoot, INDEPENDENT_BODY_VIDEO_POLICY.file)
		).catch(() => null);
		if (!installed) return;
		expect(createHash("sha256").update(installed).digest("hex")).toBe(
			INDEPENDENT_BODY_VIDEO_POLICY.sha256
		);
		expect(await independentBodyVideoAvailable({ runtimeRoot })).toBe(true);
	});
});

describe("body video sequence frames", () => {
	it("renders through the session, caches the frame and reads it back", async () => {
		const { provider, renderer: frames } = renderer();
		const first = await frames.render({ request });
		expect(first).toMatchObject({
			status: "rendered",
			requestId: "frame-1",
			cached: false,
		});
		if (first.status !== "rendered") throw new Error("not rendered");
		expect([...first.rgba]).toEqual([...output]);
		const sent = provider.render.mock.calls[0][0].request as {
			sourceKey: string;
			rgba: Uint8Array;
			sequence: {
				session: string;
				frame: number;
				timestamp: number;
				checkpoints: string;
			};
		};
		const session = independentBodyVideoSession({
			engineSha256: "e".repeat(64),
			clip,
			width: 2,
			height: 1,
		});
		expect(sent.sourceKey).toBe(INDEPENDENT_TIMELINE_SOURCE_KEY);
		expect(sent.sequence).toEqual({
			session,
			frame: 0,
			timestamp: 0,
			checkpoints: path.join(directory, "sessions", session),
		});
		expect("sequence" in sent && !("replay" in sent.sequence)).toBe(true);
		const second = await frames.render({
			request: { ...request, requestId: "frame-2" },
		});
		expect(second).toMatchObject({ status: "rendered", cached: true });
		expect(provider.render).toHaveBeenCalledTimes(1);
	});
	it("keeps frames of one session apart even when their pixels match, and values apart within a frame", async () => {
		const { provider, renderer: frames } = renderer();
		await frames.render({ request });
		await frames.render({
			request: {
				...request,
				requestId: "frame-2",
				sequence: { ...request.sequence, frame: 1 },
			},
		});
		await frames.render({
			request: {
				...request,
				requestId: "frame-3",
				adjustments: {
					enabled: true,
					values: { ...request.adjustments.values, body_adjust_SlimBody: 41 },
				},
			},
		});
		expect(provider.render).toHaveBeenCalledTimes(3);
		const third = (
			provider.render.mock.calls[2][0].request as {
				sequence: { session: string; frame: number };
			}
		).sequence;
		expect(third.frame).toBe(0);
		const [first, second] = provider.render.mock.calls.map(
			([{ request: sent }]) =>
				(sent as { sequence: { session: string; timestamp: number } }).sequence
		);
		expect(second.session).toBe(first.session);
		expect(third.session).toBe(first.session);
		expect(second.timestamp).toBeCloseTo(1 / 24, 12);
	});
	it("replays skip the cache so the engine advances, and are cached themselves", async () => {
		const { provider, renderer: frames } = renderer();
		await frames.render({ request });
		const replayed = await frames.render({
			request: {
				...request,
				requestId: "frame-2",
				sequence: { ...request.sequence, replay: true },
			},
		});
		expect(replayed).toMatchObject({ status: "rendered", cached: false });
		expect(provider.render).toHaveBeenCalledTimes(2);
		expect(
			await frames.render({ request: { ...request, requestId: "frame-3" } })
		).toMatchObject({ status: "rendered", cached: true });
	});
	it("turns a history gap into a replay result and passes other failures on", async () => {
		const provider = engine();
		provider.render
			.mockRejectedValueOnce(
				new IndependentSequenceGapError({ restartFrom: 3 })
			)
			.mockRejectedValueOnce(new Error("GPU process failed"));
		const { renderer: frames } = renderer({ provider });
		expect(
			await frames.render({
				request: {
					...request,
					sequence: { ...request.sequence, frame: 7 },
				},
			})
		).toEqual({ status: "replay", requestId: "frame-1", from: 3 });
		await expect(
			frames.render({ request: { ...request, requestId: "frame-2" } })
		).rejects.toThrow("GPU process failed");
	});
	it("refuses neighbour evidence, slow frame rates, fractional frames and foreign clips", async () => {
		const { provider, renderer: frames } = renderer();
		for (const bad of [
			{ ...request, sourceEvidence: { policy: "x", status: "unavailable" } },
			{ ...request, sequence: { ...request.sequence, fps: 9 } },
			{ ...request, sequence: { ...request.sequence, frame: 1.5 } },
			{ ...request, sequence: { ...request.sequence, clip: "clip-a" } },
			{ ...request, sequence: { ...request.sequence, extra: 1 } },
			{ ...request, rgba: input.slice(0, 4) },
		])
			await expect(frames.render({ request: bad })).rejects.toThrow();
		expect(provider.render).not.toHaveBeenCalled();
	});
	it("checks the result identity and stops after disposal", async () => {
		const provider = engine();
		provider.render.mockResolvedValueOnce({
			requestId: "other",
			width: 2,
			height: 1,
			rgba: output,
			png: png({ rgba: output, width: 2 }),
		} as BeautyLabIndependentResult);
		const { renderer: frames } = renderer({ provider });
		await expect(frames.render({ request })).rejects.toThrow(
			"identity mismatch"
		);
		frames.dispose();
		await expect(frames.render({ request })).rejects.toThrow("disposed");
	});
	it("needs an absolute checkpoint folder", () => {
		expect(() =>
			createIndependentSequenceFrameRenderer({
				provider: engine(),
				cache: createIndependentFrameCache({ directory }),
				engineSha256: async () => "e".repeat(64),
				sessionsDirectory: "sessions",
			})
		).toThrow("absolute");
	});
});
