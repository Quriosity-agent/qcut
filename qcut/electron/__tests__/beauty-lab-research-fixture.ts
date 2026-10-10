import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { createBeautyLabResearchProvider } from "../beauty-lab/beauty-lab-research.js";

export const WIDTH = 1448;
export const HEIGHT = 1086;
export const RGBA_BYTES = WIDTH * HEIGHT * 4;
export const roots: string[] = [];
export const input = Buffer.alloc(RGBA_BYTES);
export const native = Buffer.alloc(RGBA_BYTES, 42);
for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
	input[pixel * 4] = 11;
	input[pixel * 4 + 1] = 22;
	input[pixel * 4 + 2] = 33;
	input[pixel * 4 + 3] = pixel % 2 === 0 ? 127 : 255;
}

export function digest({ bytes }: { bytes: Uint8Array | string }): string {
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

export function encodePng({
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

export const png = encodePng();
export const sourceBytes = "synthetic source; never executed";
export const sourceHash = digest({ bytes: sourceBytes });
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

export async function fixture({ both = false }: { both?: boolean } = {}) {
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
				// A copy, not a link: candidate-mutation tests must leave the baseline intact.
				await fs.copyFile(
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

export async function readJson({
	filename,
}: {
	filename: string;
}): Promise<Record<string, unknown>> {
	return JSON.parse(await fs.readFile(filename, "utf8"));
}

export async function changeJson({
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

export async function relinkReports({
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
