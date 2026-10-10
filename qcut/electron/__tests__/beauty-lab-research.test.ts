// @vitest-environment node
import * as fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeautyLabResearchProvider } from "../beauty-lab/beauty-lab-research.js";
import {
	changeJson,
	digest,
	encodePng,
	fixture,
	HEIGHT,
	input,
	native,
	png,
	readJson,
	relinkReports,
	RGBA_BYTES,
	roots,
	sourceBytes,
	sourceHash,
	WIDTH,
} from "./beauty-lab-research-fixture.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, open: vi.fn(actual.open) };
});

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
