// @vitest-environment node
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeautyLabResearchProvider } from "../beauty-lab-research.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, open: vi.fn(actual.open) };
});

const WIDTH = 1448;
const HEIGHT = 1086;
const RGBA_BYTES = WIDTH * HEIGHT * 4;
const roots: string[] = [];
const input = Buffer.alloc(RGBA_BYTES);
const native = Buffer.alloc(RGBA_BYTES, 42);
for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
	input[pixel * 4] = 11;
	input[pixel * 4 + 1] = 22;
	input[pixel * 4 + 2] = 33;
	input[pixel * 4 + 3] = pixel % 2 === 0 ? 127 : 255;
}

function digest({ bytes }: { bytes: Uint8Array | string }): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function pngChunk({ type, data }: { type: string; data: Buffer }): Buffer {
	const chunk = Buffer.alloc(data.length + 12);
	chunk.writeUInt32BE(data.length, 0);
	chunk.write(type, 4, "ascii");
	data.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
	return chunk;
}

function encodePng({
	pixels = input,
	width = WIDTH,
	height = HEIGHT,
}: {
	pixels?: Buffer;
	width?: number;
	height?: number;
} = {}): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	const scanlines = Buffer.alloc((width * 4 + 1) * height);
	for (let row = 0; row < height; row++) {
		pixels.copy(
			scanlines,
			row * (width * 4 + 1) + 1,
			row * width * 4,
			(row + 1) * width * 4
		);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk({ type: "IHDR", data: header }),
		pngChunk({ type: "IDAT", data: deflateSync(scanlines) }),
		pngChunk({ type: "IEND", data: Buffer.alloc(0) }),
	]);
}

const png = encodePng();
const sourceBytes = "synthetic source; never executed";
const sourceHash = digest({ bytes: sourceBytes });
const manifestHash = digest({ bytes: "manifest" });
const policy = {
	owned_initialization_used: true,
	owned_temporal_smoothing_used: true,
	native_smoothing_seed_predictions: [],
	native_smoothing_seed_required: false,
	native_smoothing_initialization_required: true,
	native_160_sampling_input_required: true,
	independent_160_sampling_input_used: false,
};

async function fixture({ both = false }: { both?: boolean } = {}) {
	const temporary = await fs.mkdtemp(
		path.join(tmpdir(), "beauty-lab-research-")
	);
	roots.push(temporary);
	const root = path.join(
		temporary,
		"private",
		"face-temporal-campaign-20261003-r1"
	);
	const currentSourceRoot = path.join(temporary, "research");
	await fs.mkdir(currentSourceRoot, { recursive: true });
	await fs.writeFile(path.join(currentSourceRoot, "probe.py"), sourceBytes);
	await fs.mkdir(root, { recursive: true });
	const payloadBytes = JSON.stringify({
		width: WIDTH,
		height: HEIGHT,
		version: 1,
		coordinate_space: "normalized-bottom-left",
		image_sha256: manifestHash,
		frames: Array.from({ length: 24 }, () => ({ faces: [] })),
	});
	const binary = Buffer.from("synthetic replay binary");
	const frames = Array.from({ length: 7 }, (_, index) => ({
		image: "/never/read/the/manifest/image.png",
		image_sha256: digest({ bytes: "original encoded image" }),
		input_rgba_sha256: digest({ bytes: input }),
		timestamp: index / 30,
		parameters: {
			face_adjust_eye: [
				{ id: -1, intensity: index === 5 ? 0 : index === 6 ? 0.5 : 1 },
			],
		},
	}));
	const comparisons = Array.from({ length: 7 }, (_, index) => ({
		index,
		equal: true,
		changed_pixels: 0,
		max_delta: 0,
		baseline_sha256: digest({ bytes: native }),
		sha256: digest({ bytes: native }),
	}));
	const source_sha256 = { "probe.py": sourceHash };
	const reports = {
		probe: {
			passed: true,
			native_analysis_bypassed: false,
			width: WIDTH,
			height: HEIGHT,
			predictions: 26,
			frames,
			comparisons,
			source_sha256,
		},
		replay: {
			passed: true,
			completed: true,
			failures: [],
			diagnostic_only: false,
			...policy,
			geometry_exact: true,
			native_analysis_bypassed: false,
			manifest_frames: 7,
			capture_sha256: "",
			replay_sha256: digest({ bytes: payloadBytes }),
			source_sha256,
			cases: Array.from({ length: 26 }, (_, prediction) => ({ prediction })),
		},
		render: {
			passed: true,
			completed: true,
			failures: [],
			diagnostic_only: false,
			width: WIDTH,
			height: HEIGHT,
			native_analysis_bypassed: false,
			product_parity_verified: false,
			external_replay_verified: true,
			pixel_parity_verified: true,
			frames,
			comparisons,
			capture_sha256: "",
			replay_sha256: digest({ bytes: payloadBytes }),
			manifest_sha256: manifestHash,
			source_sha256,
			out: "/historical/private/campaign-00/render",
			fixture_sha256: {
				"/historical/private/campaign-00/render/replay.bin": digest({
					bytes: binary,
				}),
			},
		},
		audit: {
			passed: true,
			completed: true,
			failures: [],
			...policy,
			pipeline_parity: true,
			source_hashes_verified: true,
			source_count: 1,
			raw_evidence_revalidated: false,
			product_parity_verified: false,
			predictions: 26,
			conversions: 24,
			manifest_frames: 7,
			report_sha256: { capture: "", sequence_replay: "", sequence_render: "" },
		},
	};
	const probe = { ...reports.probe, failures: [] };
	const campaigns: {
		index: number;
		passed: boolean;
		completed: boolean;
		manifest_sha256: string;
		stages: unknown[];
	}[] = [];
	const indices = both ? [0, 1] : [0];
	await indices.reduce(
		(previous, index) =>
			previous.then(async () => {
				const directory = path.join(
					root,
					`campaign-${String(index).padStart(2, "0")}`
				);
				await Promise.all(
					["probe/baseline", "replay", "render", "audit"].map((relative) =>
						fs.mkdir(path.join(directory, relative), { recursive: true })
					)
				);
				await Promise.all([
					fs.writeFile(path.join(directory, "probe/input-00.png"), png),
					fs.writeFile(
						path.join(directory, "probe/baseline/frame-00.rgba"),
						native
					),
					fs.writeFile(
						path.join(directory, "replay/replay.json"),
						payloadBytes
					),
					fs.writeFile(path.join(directory, "render/replay.bin"), binary),
				]);
				await fs.link(
					path.join(directory, "probe/baseline/frame-00.rgba"),
					path.join(directory, "render/frame-00.rgba")
				);
				await Promise.all(
					Array.from({ length: 6 }, (_, offset) => {
						const suffix = String(offset + 1).padStart(2, "0");
						return Promise.all([
							fs.link(
								path.join(directory, "probe/input-00.png"),
								path.join(directory, `probe/input-${suffix}.png`)
							),
							fs.link(
								path.join(directory, "probe/baseline/frame-00.rgba"),
								path.join(directory, `probe/baseline/frame-${suffix}.rgba`)
							),
							fs.link(
								path.join(directory, "render/frame-00.rgba"),
								path.join(directory, `render/frame-${suffix}.rgba`)
							),
						]);
					})
				);
				await fs.writeFile(
					path.join(directory, "probe/report.json"),
					JSON.stringify(probe)
				);
				await fs.writeFile(
					path.join(directory, "replay/report.json"),
					JSON.stringify(reports.replay)
				);
				await fs.writeFile(
					path.join(directory, "render/report.json"),
					JSON.stringify(reports.render)
				);
				await fs.writeFile(
					path.join(directory, "audit/report.json"),
					JSON.stringify(reports.audit)
				);
				campaigns.push({
					index,
					passed: true,
					completed: true,
					manifest_sha256: manifestHash,
					stages: [],
				});
			}),
		Promise.resolve()
	);
	await fs.writeFile(
		path.join(root, "report.json"),
		JSON.stringify({
			passed: true,
			completed: true,
			pipeline_parity: true,
			failures: [],
			product_parity_verified: false,
			native_analysis_required: true,
			profile: { manifest_frames: 7, predictions: 26, conversions: 24 },
			campaigns,
		})
	);
	await indices.reduce(
		(previous, index) => previous.then(() => relinkReports({ root, index })),
		Promise.resolve()
	);
	return {
		temporary,
		root,
		currentSourceRoot,
		provider: createBeautyLabResearchProvider({ root, currentSourceRoot }),
	};
}

async function readJson({
	filename,
}: {
	filename: string;
}): Promise<Record<string, unknown>> {
	return JSON.parse(await fs.readFile(filename, "utf8"));
}

async function changeJson({
	filename,
	patch,
}: {
	filename: string;
	patch: Record<string, unknown>;
}): Promise<void> {
	await fs.writeFile(
		filename,
		JSON.stringify({ ...(await readJson({ filename })), ...patch })
	);
}

async function relinkReports({
	root,
	index = 0,
}: {
	root: string;
	index?: number;
}): Promise<void> {
	const directory = path.join(
		root,
		`campaign-${String(index).padStart(2, "0")}`
	);
	const hashReport = async ({ stage }: { stage: string }) =>
		digest({
			bytes: await fs.readFile(path.join(directory, stage, "report.json")),
		});
	const capture = await hashReport({ stage: "probe" });
	await Promise.all(
		["replay", "render"].map((stage) =>
			changeJson({
				filename: path.join(directory, stage, "report.json"),
				patch: { capture_sha256: capture },
			})
		)
	);
	await changeJson({
		filename: path.join(directory, "audit/report.json"),
		patch: {
			report_sha256: {
				capture,
				sequence_replay: await hashReport({ stage: "replay" }),
				sequence_render: await hashReport({ stage: "render" }),
			},
		},
	});
	const stages = await Promise.all(
		["probe", "replay", "render", "audit"].map(async (name) => ({
			name,
			passed: true,
			completed: true,
			status: "passed",
			returncode: 0,
			report_sha256: await hashReport({ stage: name }),
		}))
	);
	const filename = path.join(root, "report.json");
	const campaign = await readJson({ filename });
	const entries = campaign.campaigns as Record<string, unknown>[];
	await changeJson({
		filename,
		patch: {
			campaigns: entries.map((entry) =>
				entry.index === index ? { ...entry, stages } : entry
			),
		},
	});
}

beforeEach(async () => {
	const actual = await vi.importActual<typeof fs>("node:fs/promises");
	vi.mocked(fs.open).mockImplementation(actual.open);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
	);
});

describe("Beauty Lab verified offline research", () => {
	it("lists only the fixed cases and returns byte-exact RGBA with honest provenance", async () => {
		const { provider } = await fixture({ both: true });
		expect(await provider.list()).toEqual([
			{ id: "temporal", name: "Temporal Research Replay", frameCount: 7 },
			{ id: "qcut-export", name: "QCut Export Research Replay", frameCount: 7 },
		]);
		const frame = await provider.load({ caseId: "qcut-export", frameIndex: 0 });
		const {
			input: actualInput,
			native: actualNative,
			candidate: actualCandidate,
			...metadata
		} = frame;
		expect(metadata).toEqual({
			caseId: "qcut-export",
			frameIndex: 0,
			width: WIDTH,
			height: HEIGHT,
			source: "verified-offline-replay",
			sourceHashesVerified: true,
			nativeDependencies: true,
			adjustments: { enabled: true, values: { face_adjust_eye: 100 } },
		});
		expect(Buffer.from(actualInput).equals(input)).toBe(true);
		expect(Buffer.from(actualNative).equals(native)).toBe(true);
		expect(Buffer.from(actualCandidate).equals(native)).toBe(true);
		expect(actualInput instanceof Uint8Array).toBe(true);
		expect(actualNative === actualCandidate).toBe(false);
	});

	it.each([
		{ frameIndex: 5, enabled: false, value: 0 },
		{ frameIndex: 6, enabled: true, value: 50 },
	])("translates only the recorded eye intensity for frame $frameIndex", async ({
		frameIndex,
		enabled,
		value,
	}) => {
		const { provider } = await fixture();
		const frame = await provider.load({ caseId: "temporal", frameIndex });
		expect(frame.adjustments).toEqual({
			enabled,
			values: { face_adjust_eye: value },
		});
	});

	it.each([
		"unknown",
		"../campaign-00",
		"/campaign-00",
		"temporal/../qcut-export",
		"__proto__",
		"C:\\campaign-00",
	])("refuses case id %s", async (caseId) => {
		const provider = createBeautyLabResearchProvider({ root: "/nonexistent" });
		await expect(provider.load({ caseId, frameIndex: 0 })).rejects.toThrow(
			"unknown case id"
		);
	});

	it.each([
		true,
		false,
		"0",
		null,
		NaN,
		Infinity,
		-1,
		7,
		0.5,
	])("refuses frame index %s", async (frameIndex) => {
		const provider = createBeautyLabResearchProvider({ root: "/nonexistent" });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: frameIndex as number })
		).rejects.toThrow("invalid frame index");
	});

	it("omits missing records and requires an explicitly permitted current source root", async () => {
		expect(
			await createBeautyLabResearchProvider({ root: "/nonexistent" }).list()
		).toEqual([]);
		const { root, provider } = await fixture();
		expect((await provider.list()).map((entry) => entry.id)).toEqual([
			"temporal",
		]);
		await expect(
			createBeautyLabResearchProvider({ root }).load({
				caseId: "temporal",
				frameIndex: 0,
			})
		).rejects.toThrow("currentSourceRoot");
		await fs.unlink(path.join(root, "campaign-00/render/frame-06.rgba"));
		expect(await provider.list()).toEqual([]);
	});

	it.each([
		["audit", { pipeline_parity: false }],
		["audit", { source_hashes_verified: false }],
		["audit", { owned_initialization_used: false }],
		["audit", { native_smoothing_seed_predictions: [0] }],
		["audit", { raw_evidence_revalidated: true }],
		["audit", { product_parity_verified: true }],
		["audit", { conversions: 23 }],
		["audit", { predictions: 25 }],
		["audit", { manifest_frames: 6 }],
		["audit", { completed: false }],
		["audit", { passed: false }],
		["audit", { source_count: 2 }],
		["replay", { diagnostic_only: true }],
		["replay", { native_smoothing_seed_required: true }],
		["render", { pixel_parity_verified: false }],
		["render", { width: 2 }],
		["probe", { height: 2 }],
	] as const)("rejects %s evidence flag %j even with updated report links", async (stage, patch) => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, "campaign-00", stage, "report.json"),
			patch,
		});
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
		expect(await provider.list()).toEqual([]);
	});

	it.each([
		"passed",
		"completed",
		"pipeline_parity",
	])("requires campaign %s", async (key) => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, "report.json"),
			patch: { [key]: false },
		});
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it.each([
		"probe/report.json",
		"replay/report.json",
		"render/report.json",
		"audit/report.json",
		"replay/replay.json",
		"render/replay.bin",
	])("hashes actual report/payload bytes in %s", async (relative) => {
		const { root, provider } = await fixture();
		await fs.appendFile(path.join(root, "campaign-00", relative), " ");
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("SHA mismatch");
	});

	it("checks current source bytes on every load without caching verification", async () => {
		const { currentSourceRoot, provider } = await fixture();
		const frame = await provider.load({ caseId: "temporal", frameIndex: 0 });
		frame.candidate[0] = 255;
		expect(
			(await provider.load({ caseId: "temporal", frameIndex: 0 })).candidate[0]
		).toBe(42);
		await fs.writeFile(
			path.join(currentSourceRoot, "probe.py"),
			"mutated source"
		);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("SHA mismatch");
	});

	it.each([
		"/absolute.py",
		"../escape.py",
		"nested/../../escape.py",
		"C:\\escape.py",
		"nested\\escape.py",
		"./probe.py",
	])("never reads unsafe report source path %s", async (sourcePath) => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, "campaign-00/probe/report.json"),
			patch: { source_sha256: { [sourcePath]: sourceHash } },
		});
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("unsafe research path");
	});

	it.each([
		"probe/baseline/frame-00.rgba",
		"render/frame-00.rgba",
		"probe/input-00.png",
	])("refuses escaping file symlinks for %s", async (relative) => {
		const { root, temporary, provider } = await fixture();
		const filename = path.join(root, "campaign-00", relative);
		const outside = path.join(temporary, "outside");
		await fs.rename(filename, outside);
		await fs.symlink(outside, filename);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("symlink");
		expect(await provider.list()).toEqual([]);
	});

	it("pins roots across calls and rejects a later escaping root replacement", async () => {
		const { root, temporary, provider } = await fixture();
		await provider.list();
		const moved = path.join(temporary, "moved");
		await fs.rename(root, moved);
		await fs.symlink(moved, root);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("changed research root");
	});

	it("refuses directory symlinks and symlinked current source files", async () => {
		const { root, temporary, currentSourceRoot, provider } = await fixture();
		const outside = path.join(temporary, "outside-source.py");
		await fs.writeFile(outside, sourceBytes);
		await fs.unlink(path.join(currentSourceRoot, "probe.py"));
		await fs.symlink(outside, path.join(currentSourceRoot, "probe.py"));
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("symlink");
		const directory = path.join(root, "campaign-00/render");
		await fs.rename(directory, path.join(temporary, "outside-render"));
		await fs.symlink(path.join(temporary, "outside-render"), directory);
		expect(await provider.list()).toEqual([]);
	});

	it.each([1, RGBA_BYTES + 1])("refuses RGBA byte count %s", async (length) => {
		const { root, provider } = await fixture();
		await fs.truncate(
			path.join(root, "campaign-00/render/frame-00.rgba"),
			length
		);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it("refuses changed pixels even when their byte count still matches", async () => {
		const { root, provider } = await fixture();
		await fs.writeFile(
			path.join(root, "campaign-00/render/frame-00.rgba"),
			Buffer.alloc(RGBA_BYTES, 43)
		);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("SHA mismatch");
	});

	it.each([
		Buffer.from("not PNG"),
		encodePng({ width: 1, height: 1 }),
		encodePng({ pixels: native }),
	])("requires the recorded PNG dimensions and decoded input SHA", async (bytes) => {
		const { root, provider } = await fixture();
		await fs.writeFile(
			path.join(root, "campaign-00/probe/input-00.png"),
			bytes
		);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it("bounds JSON before parsing", async () => {
		const { root, provider } = await fixture();
		await fs.truncate(path.join(root, "report.json"), 1024 * 1024 + 1);
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("oversized");
	});

	it.each([
		{ equal: false },
		{ equal: 1 },
		{ changed_pixels: 1 },
		{ max_delta: 1 },
		{ index: true },
		{ baseline_sha256: "a".repeat(64) },
		{ sha256: "b".repeat(64) },
	])("rejects selected frame comparison %j", async (patch) => {
		const { root, provider } = await fixture();
		const filename = path.join(root, "campaign-00/render/report.json");
		const report = await readJson({ filename });
		const comparisons = report.comparisons as Record<string, unknown>[];
		await changeJson({
			filename,
			patch: {
				comparisons: [{ ...comparisons[0], ...patch }, ...comparisons.slice(1)],
			},
		});
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it.each([
		{ face_adjust_eye: [{ id: -1, intensity: -0.01 }] },
		{ face_adjust_eye: [{ id: -1, intensity: 1.01 }] },
		{ face_adjust_eye: [{ id: -1, intensity: true }] },
		{ face_adjust_eye: [{ id: 0, intensity: 1 }] },
		{ face_adjust_eye: [] },
		{
			face_adjust_eye: [
				{ id: -1, intensity: 1 },
				{ id: -1, intensity: 0 },
			],
		},
		{
			face_adjust_eye: [{ id: -1, intensity: 1 }],
			face_adjust_nose: [{ id: -1, intensity: 1 }],
		},
	])("does not invent controls from unsupported recorded parameters %j", async (parameters) => {
		const { root, provider } = await fixture();
		await Promise.all(
			["probe", "render"].map(async (stage) => {
				const filename = path.join(root, "campaign-00", stage, "report.json");
				const report = await readJson({ filename });
				const frames = report.frames as Record<string, unknown>[];
				await changeJson({
					filename,
					patch: { frames: [{ ...frames[0], parameters }, ...frames.slice(1)] },
				});
			})
		);
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it.each([
		{ stage: "probe", field: "frames", length: 6 },
		{ stage: "render", field: "comparisons", length: 6 },
		{ stage: "replay", field: "cases", length: 25 },
	])("requires exactly the recorded $field count", async ({
		stage,
		field,
		length,
	}) => {
		const { root, provider } = await fixture();
		const filename = path.join(root, "campaign-00", stage, "report.json");
		const report = await readJson({ filename });
		await changeJson({
			filename,
			patch: { [field]: (report[field] as unknown[]).slice(0, length) },
		});
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it("requires exactly 24 replay conversions even with refreshed payload hashes", async () => {
		const { root, provider } = await fixture();
		const filename = path.join(root, "campaign-00/replay/replay.json");
		const payload = await readJson({ filename });
		await changeJson({
			filename,
			patch: { frames: (payload.frames as unknown[]).slice(0, 23) },
		});
		const replay_sha256 = digest({ bytes: await fs.readFile(filename) });
		await Promise.all(
			["replay", "render"].map((stage) =>
				changeJson({
					filename: path.join(root, "campaign-00", stage, "report.json"),
					patch: { replay_sha256 },
				})
			)
		);
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it("rejects cross-report source disagreement and stale audit report links", async () => {
		const { root, provider } = await fixture();
		const filename = path.join(root, "campaign-00/replay/report.json");
		await changeJson({
			filename,
			patch: { source_sha256: { "probe.py": "a".repeat(64) } },
		});
		await relinkReports({ root });
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("conflicting source hashes");
		await changeJson({
			filename: path.join(root, "campaign-00/audit/report.json"),
			patch: {
				report_sha256: {
					capture: "a".repeat(64),
					sequence_replay: "a".repeat(64),
					sequence_render: "a".repeat(64),
				},
			},
		});
		const campaignFile = path.join(root, "report.json");
		const campaign = await readJson({ filename: campaignFile });
		const entries = campaign.campaigns as Record<string, unknown>[];
		const stages = entries[0].stages as Record<string, unknown>[];
		const auditHash = digest({
			bytes: await fs.readFile(
				path.join(root, "campaign-00/audit/report.json")
			),
		});
		await changeJson({
			filename: campaignFile,
			patch: {
				campaigns: [
					{
						...entries[0],
						stages: stages.map((stage) =>
							stage.name === "audit"
								? { ...stage, report_sha256: auditHash }
								: stage
						),
					},
				],
			},
		});
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("report SHA or frame links differ");
	});

	it("rejects an escaping symlink swapped between path checking and open", async () => {
		const { root, temporary, provider } = await fixture();
		const filename = await fs.realpath(
			path.join(root, "campaign-00/probe/input-00.png")
		);
		const outside = path.join(temporary, "outside.png");
		await fs.writeFile(outside, png);
		const { open: originalOpen } =
			await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			if (args[0] === filename) {
				await fs.unlink(filename);
				await fs.symlink(outside, filename);
			}
			return originalOpen(...args);
		});
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow();
	});

	it("detects a file growing during the bounded read", async () => {
		const { root, provider } = await fixture();
		const filename = await fs.realpath(
			path.join(root, "campaign-00/probe/input-00.png")
		);
		const { open: originalOpen } =
			await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			const handle = await originalOpen(...args);
			if (args[0] === filename) {
				const originalRead = handle.read.bind(handle);
				vi.spyOn(handle, "read").mockImplementationOnce(
					async (...readArgs: Parameters<typeof originalRead>) => {
						await fs.appendFile(filename, "growth");
						return originalRead(...readArgs);
					}
				);
			}
			return handle;
		});
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("changed while reading");
	});

	it("rehashes earlier source reads before returning a frame", async () => {
		const { root, currentSourceRoot, provider } = await fixture();
		const filename = await fs.realpath(
			path.join(root, "campaign-00/probe/input-00.png")
		);
		const { open: originalOpen } =
			await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			if (args[0] === filename) {
				await fs.writeFile(
					path.join(currentSourceRoot, "probe.py"),
					"changed after initial source verification"
				);
			}
			return originalOpen(...args);
		});
		await expect(
			provider.load({ caseId: "temporal", frameIndex: 0 })
		).rejects.toThrow("file changed during load");
	});
});
