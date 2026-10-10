// @vitest-environment node
import * as fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeautyLabOwnedChainProvider } from "../beauty-lab/beauty-lab-owned-chain.js";
import {
	OWNED_CHAIN_REPORT_FILES,
	OWNED_CHAIN_CAPTURE_SOURCES,
	OWNED_CHAIN_ORIGINAL_FORMAT,
	OWNED_CHAIN_LEGACY_PROBE_SHA256,
} from "../beauty-lab/beauty-lab-owned-chain-evidence.js";
import { verifyOwnedChainReports } from "../beauty-lab/beauty-lab-owned-chain-verify.js";
import { WIDTH, HEIGHT } from "../beauty-lab/beauty-lab-research-files.js";
import {
	changeJson,
	digest,
	effect,
	exact,
	fixture,
	frames,
	input,
	modelHash,
	originalFixture,
	png,
	relink,
	sourceHash,
	temporaryRoots,
} from "./beauty-lab-owned-chain-fixture.js";

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
	await temporaryRoots
		.splice(0)
		.reduce(
			(previous, root) =>
				previous.then(() => fs.rm(root, { recursive: true, force: true })),
			Promise.resolve()
		);
});

describe("Beauty Lab owned-chain offline provider", () => {
	it.each([
		OWNED_CHAIN_LEGACY_PROBE_SHA256,
		sourceHash,
	])("only the explicit historical probe hash allows the helper-free source closure: %s", async (probeHash) => {
		const { root } = await fixture();
		const indexFile = path.join(root, "index.json");
		const before = JSON.parse(await fs.readFile(indexFile, "utf8"));
		await changeJson({
			filename: indexFile,
			patch: {
				source_sha256: {
					...Object.fromEntries(
						Object.entries(before.source_sha256).filter(
							([name]) => !name.endsWith("/face_native_process.py")
						)
					),
					"local-model-pytorch/face_preprocess_probe.py": probeHash,
				},
			},
		});
		await relink({ root, legacyProbeHash: probeHash });
		const reports = await Object.entries(OWNED_CHAIN_REPORT_FILES).reduce(
			(previous, [key, name]) =>
				previous.then(async (value) => ({
					...value,
					[key]: JSON.parse(await fs.readFile(path.join(root, name), "utf8")),
				})),
			Promise.resolve({})
		);
		const verify = () =>
			verifyOwnedChainReports({
				index: JSON.parse(requireIndex),
				payload: JSON.parse(requirePayload),
				reports: reports as Parameters<
					typeof verifyOwnedChainReports
				>[0]["reports"],
			});
		const requireIndex = await fs.readFile(indexFile, "utf8");
		const requirePayload = await fs.readFile(
			path.join(root, "replay.json"),
			"utf8"
		);
		if (probeHash === OWNED_CHAIN_LEGACY_PROBE_SHA256) {
			expect(verify()["local-model-pytorch/face_preprocess_probe.py"]).toBe(
				probeHash
			);
		} else expect(verify).toThrow("explicit legacy probe source");
	});
	it("loads the separately audited original-RGBA profile without claiming a live backend", async () => {
		const { provider } = await originalFixture();
		expect(await provider.list()).toEqual([
			{
				id: "owned-preprocess",
				name: "Original RGBA Owned Chain Research Replay",
				frameCount: 7,
			},
		]);
		const frame = await provider.load({
			caseId: "owned-preprocess",
			frameIndex: 6,
		});
		expect(frame).toMatchObject({
			source: "verified-offline-replay",
			sourceHashesVerified: true,
			nativeDependencies: true,
			adjustments: { enabled: true, values: { face_adjust_eye: 20 } },
		});
		expect(Buffer.from(frame.native).equals(Buffer.from(frame.candidate))).toBe(
			true
		);
	});
	it.each([
		"candidate",
		"render",
		"chain-audit",
	])("rejects a relabelled original %s profile", async (name) => {
		const { root, provider } = await originalFixture();
		await changeJson({
			filename: path.join(root, `reports/${name}.json`),
			patch: { profile: "actual-preprocess-owned-chain-v1" },
		});
		await relink({ root });
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it.each([
		{ original_rgba_input_used: false },
		{ independent_full_frame_preprocessing: false },
		{ native_algorithm_rgba_input_used: true },
		{ native_algorithm_rgba_oracle_required: false },
		{ product_parity_verified: true },
		{ arbitrary_frame_backend_connected: true },
	])("rejects original-frame ownership overclaims or contradictions %j", async (patch) => {
		const { root, provider } = await originalFixture();
		await changeJson({
			filename: path.join(root, "reports/candidate.json"),
			patch,
		});
		await relink({ root });
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it.each([
		"input",
		"observation",
		"120",
		"160",
		"closure",
		"audit",
	])("rejects a rehashed broken original %s association", async (kind) => {
		const { root, provider } = await originalFixture();
		const candidateFile = path.join(root, "reports/candidate.json");
		const candidate = JSON.parse(await fs.readFile(candidateFile, "utf8"));
		const auditFile = path.join(root, "reports/chain-audit.json");
		if (kind === "input")
			candidate.preprocessing.source_frames[0].original_rgba_sha256 =
				sourceHash;
		if (kind === "observation")
			candidate.preprocessing.observations[14].frame_index = 0;
		if (kind === "120") {
			candidate.preprocessing.sampling_cases[0].input_sha256 = sourceHash;
			candidate.sampling_cases = candidate.preprocessing.sampling_cases;
		}
		if (kind === "160") {
			candidate.preprocessing.initialization_sampling_cases[0].generated_tensor_sha256 =
				sourceHash;
			candidate.initialization_sampling_cases =
				candidate.preprocessing.initialization_sampling_cases;
		}
		if (kind === "closure") candidate.source_sha256 = {};
		await changeJson({ filename: candidateFile, patch: candidate });
		await changeJson({
			filename: auditFile,
			patch: {
				preprocessing: candidate.preprocessing,
				...(kind === "audit" ? { normalized_conversions: 23 } : {}),
			},
		});
		await relink({ root });
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it.each([
		false,
		true,
	])("requires capture-bound cleanup helper in current mode original=%s", async (originalFrames) => {
		const { root, provider } = await (originalFrames
			? originalFixture()
			: fixture());
		const captureFile = path.join(root, "reports/capture.json");
		const capture = JSON.parse(await fs.readFile(captureFile, "utf8"));
		capture.fixture_sha256 = Object.fromEntries(
			Object.entries(capture.fixture_sha256).filter(
				([name]) => !name.endsWith("/face_native_process.py")
			)
		);
		await changeJson({ filename: captureFile, patch: capture });
		const indexFile = path.join(root, "index.json");
		const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
		await changeJson({
			filename: indexFile,
			patch: {
				reports: {
					...index.reports,
					capture: digest({ bytes: await fs.readFile(captureFile) }),
				},
			},
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it("does not accept a legacy package relabelled with the original format", async () => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, "index.json"),
			patch: { format: OWNED_CHAIN_ORIGINAL_FORMAT },
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it("lists the third case and verifies seven frames, nonzero effects and controls", async () => {
		const { provider } = await fixture();
		expect(await provider.list()).toEqual([
			{
				id: "owned-preprocess",
				name: "Owned Preprocess Research Replay",
				frameCount: 7,
			},
		]);
		const frame = await provider.load({
			caseId: "owned-preprocess",
			frameIndex: 0,
		});
		expect(frame).toMatchObject({
			caseId: "owned-preprocess",
			frameIndex: 0,
			width: WIDTH,
			height: HEIGHT,
			source: "verified-offline-replay",
			sourceHashesVerified: true,
			nativeDependencies: true,
			adjustments: { enabled: true, values: { face_adjust_eye: 100 } },
		});
		expect(Buffer.from(frame.input).equals(input)).toBe(true);
		expect(Buffer.from(frame.native).equals(effect)).toBe(true);
		expect(Buffer.from(frame.candidate).equals(effect)).toBe(true);
		// Negated toBe generates a costly deep-equality hint for multi-megabyte arrays.
		expect(frame.native === frame.candidate).toBe(false);
		frame.candidate[0] = 99;
		expect(frame.native[0]).toBe(12);
	}, 15_000);
	it.each([
		{ frameIndex: 3, value: 100 },
		{ frameIndex: 5, value: 0 },
		{ frameIndex: 6, value: 50 },
	])("returns recorded frame $frameIndex", async ({ frameIndex, value }) => {
		const { provider } = await fixture();
		const frame = await provider.load({
			caseId: "owned-preprocess",
			frameIndex,
		});
		expect(frame.adjustments).toEqual({
			enabled: value !== 0,
			values: { face_adjust_eye: value },
		});
		expect(
			Buffer.from(frame.native).equals(frameIndex === 6 ? effect : input)
		).toBe(true);
	});
	it.each([
		"../owned-preprocess",
		"/owned-preprocess",
		"temporal",
		"__proto__",
	])("refuses unknown case %s without filesystem work", async (caseId) => {
		await expect(
			createBeautyLabOwnedChainProvider({ root: "/nonexistent" }).load({
				caseId,
				frameIndex: 0,
			})
		).rejects.toThrow("unknown owned-chain case");
	});
	it.each([
		-1,
		7,
		0.5,
		NaN,
		true,
		"0",
	])("rejects invalid index %s", async (frameIndex) => {
		await expect(
			createBeautyLabOwnedChainProvider({ root: "/nonexistent" }).load({
				caseId: "owned-preprocess",
				frameIndex: frameIndex as number,
			})
		).rejects.toThrow("invalid owned-chain frame");
	});
	it("omits missing packages and requires trusted source root", async () => {
		expect(
			await createBeautyLabOwnedChainProvider({ root: "/missing" }).list()
		).toEqual([]);
		const { root } = await fixture();
		await expect(
			createBeautyLabOwnedChainProvider({ root }).load({
				caseId: "owned-preprocess",
				frameIndex: 0,
			})
		).rejects.toThrow("currentSourceRoot");
	});
	it.each([
		"index.json",
		"reports/model.json",
		"reports/original-audit.json",
		"frames/native-06.rgba",
		"frames/input-03.png",
		"replay.json",
	])("omits missing %s even for frame 0", async (relative) => {
		const { root, provider } = await fixture();
		await fs.unlink(path.join(root, relative));
		expect(await provider.list()).toEqual([]);
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it.each([
		"reports/candidate.json",
		"reports/summary.json",
		"frames/candidate-06.rgba",
		"frames/input-01.png",
		"manifest.json",
		"replay.json",
	])("refuses tampered %s", async (relative) => {
		const { root, provider } = await fixture();
		await fs.appendFile(path.join(root, relative), " ");
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it.each([
		"file-0.py",
		"chain.py",
		"model.py",
		"face_preprocess_probe.py",
		"face_preprocess_lldb.py",
		"face_preprocess_memory.py",
	])("requires current source %s unchanged", async (name) => {
		const { currentSourceRoot, provider } = await fixture();
		await fs.appendFile(
			path.join(currentSourceRoot, "local-model-pytorch", name),
			"stale"
		);
		expect(await provider.list()).toEqual([]);
	});
	it("requires the original 50-file union, not only the audit boolean", async () => {
		const { root, provider } = await fixture();
		const fewerSources = Object.fromEntries(
			Array.from({ length: 49 }, (_, index) => [
				`local-model-pytorch/file-${index}.py`,
				sourceHash,
			])
		);
		await ["originalCapture", "originalReplay", "originalRender"].reduce(
			(previous, key) =>
				previous.then(() =>
					changeJson({
						filename: path.join(
							root,
							OWNED_CHAIN_REPORT_FILES[
								key as keyof typeof OWNED_CHAIN_REPORT_FILES
							]
						),
						patch: { source_sha256: fewerSources },
					})
				),
			Promise.resolve()
		);
		await relink({ root });
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("original source guard must contain 50");
	});
	it("requires capture hashes in the exact current-source index", async () => {
		const { root, provider } = await fixture();
		const filename = path.join(root, "index.json");
		const index = JSON.parse(await fs.readFile(filename, "utf8"));
		await changeJson({
			filename,
			patch: {
				source_sha256: Object.fromEntries(
					Object.entries(index.source_sha256).filter(
						([key]) => key !== OWNED_CHAIN_CAPTURE_SOURCES[0]
					)
				),
			},
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("source index differs");
	});
	it.each([
		"/outside.py",
		"../outside.py",
		"local-model-pytorch/../outside.py",
		"C:\\outside.py",
		"local-model-pytorch//bad.py",
	])("refuses source path %s", async (name) => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, "index.json"),
			patch: { source_sha256: { [name]: sourceHash } },
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it.each([
		"frames/input-00.png",
		"reports/capture.json",
		"frames/native-06.rgba",
	])("refuses file symlink %s", async (relative) => {
		const { temporary, root, provider } = await fixture();
		const filename = path.join(root, relative);
		const outside = path.join(temporary, "outside");
		await fs.copyFile(filename, outside);
		await fs.unlink(filename);
		await fs.symlink(outside, filename);
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("symlink");
	});
	it("rejects symlinked package and current source roots", async () => {
		const { temporary, root, currentSourceRoot } = await fixture();
		const link = path.join(temporary, "link");
		await fs.symlink(root, link);
		expect(
			await createBeautyLabOwnedChainProvider({
				root: link,
				currentSourceRoot,
			}).list()
		).toEqual([]);
		const sourceLink = path.join(temporary, "source-link");
		await fs.symlink(currentSourceRoot, sourceLink);
		expect(
			await createBeautyLabOwnedChainProvider({
				root,
				currentSourceRoot: sourceLink,
			}).list()
		).toEqual([]);
	});
	it("pins root identity between calls", async () => {
		const { temporary, root, provider } = await fixture();
		expect(await provider.list()).toHaveLength(1);
		const moved = path.join(temporary, "moved");
		await fs.rename(root, moved);
		await fs.symlink(moved, root);
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("changed research root");
	});
	it.each([
		{ report: "candidate", patch: { native_final_point_input_used: true } },
		{ report: "candidate", patch: { captured_tensor_input_used: true } },
		{ report: "candidate", patch: { arbitrary_frame_backend_connected: true } },
		{
			report: "candidate",
			patch: { independent_160_sampling_input_used: false },
		},
		{ report: "candidate", patch: { owned_smoothing_seed_predictions: [0] } },
		{ report: "render", patch: { native_analysis_bypassed: true } },
		{ report: "render", patch: { product_parity_verified: true } },
		{ report: "capture", patch: { old_sources_verified: 49 } },
		{ report: "originalAudit", patch: { source_count: 49 } },
	])("rejects incompatible $report policy after refreshing hashes", async ({
		report,
		patch,
	}) => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(
				root,
				OWNED_CHAIN_REPORT_FILES[
					report as keyof typeof OWNED_CHAIN_REPORT_FILES
				]
			),
			patch,
		});
		await relink({ root });
		expect(await provider.list()).toEqual([]);
	});
	it("rejects model identity mismatch even when reports are relinked", async () => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, OWNED_CHAIN_REPORT_FILES.summary),
			patch: {
				artifacts: {
					"align-120/artifacts/model.onnx": sourceHash,
					"align-160/artifacts/model.onnx": modelHash,
				},
			},
		});
		await relink({ root });
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("model identity");
	});
	it("rejects false nonzero-effect claims from actual pixels", async () => {
		const { root, provider } = await fixture();
		const filename = path.join(root, OWNED_CHAIN_REPORT_FILES.render);
		const report = JSON.parse(await fs.readFile(filename, "utf8"));
		report.comparisons[0].versus_input.changed_pixels = 2;
		await fs.writeFile(filename, JSON.stringify(report));
		await relink({ root });
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("actual effect/control");
	});
	it("rejects extra index fields instead of accepting renderer-style root authorization", async () => {
		const { root, provider } = await fixture();
		await changeJson({
			filename: path.join(root, "index.json"),
			patch: { root: "/outside", live: true },
		});
		expect(await provider.list()).toEqual([]);
	});
	it("rejects a symlink swap before open", async () => {
		const { temporary, root, provider } = await fixture();
		const filename = path.join(root, "frames/input-00.png");
		const outside = path.join(temporary, "outside.png");
		await fs.writeFile(outside, png);
		const actual = await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			if (args[0] === filename) {
				await fs.unlink(filename);
				await fs.symlink(outside, filename);
			}
			return actual.open(...args);
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow();
	});
	it("catches current source mutation after initial verification", async () => {
		const { root, currentSourceRoot, provider } = await fixture();
		const filename = path.join(root, "frames/input-06.png");
		let changed = false;
		const actual = await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			if (args[0] === filename && !changed) {
				changed = true;
				await fs.appendFile(
					path.join(currentSourceRoot, "local-model-pytorch/file-0.py"),
					"changed"
				);
			}
			return actual.open(...args);
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("file changed during load");
	});
	it("catches an earlier frame mutation during a later frame read", async () => {
		const { root, provider } = await fixture();
		const filename = path.join(root, "frames/input-06.png");
		let changed = false;
		const actual = await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			if (args[0] === filename && !changed) {
				changed = true;
				await fs.writeFile(path.join(root, "frames/candidate-00.rgba"), input);
			}
			return actual.open(...args);
		});
		await expect(
			provider.load({ caseId: "owned-preprocess", frameIndex: 0 })
		).rejects.toThrow("file changed during load");
	});
});
