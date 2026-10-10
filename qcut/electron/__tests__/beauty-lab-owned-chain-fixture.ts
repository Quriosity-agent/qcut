import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { createBeautyLabOwnedChainProvider } from "../beauty-lab/beauty-lab-owned-chain.js";
import {
	OWNED_CHAIN_PACKAGE_FORMAT,
	OWNED_CHAIN_REPORT_FILES,
	OWNED_CHAIN_CAPTURE_SOURCES,
	OWNED_CHAIN_ORIGINAL_FORMAT,
	OWNED_CHAIN_ORIGINAL_SOURCES,
} from "../beauty-lab/beauty-lab-owned-chain-evidence.js";
import { buildJianyingPortraitFeatureParameters } from "../jianying-portrait-adjustment-runtime/catalog.js";
import {
	WIDTH,
	HEIGHT,
	RGBA_BYTES,
} from "../beauty-lab/beauty-lab-research-files.js";

export const temporaryRoots: string[] = [];
export const input = Buffer.alloc(RGBA_BYTES, 11);
export const effect = Buffer.from(input);
effect[0] = 12;
export const digest = ({ bytes }: { bytes: Uint8Array | string }) =>
	createHash("sha256").update(bytes).digest("hex");
const inputHash = digest({ bytes: input });
const effectHash = digest({ bytes: effect });
const graphHash = digest({ bytes: "synthetic graph" });
export const modelHash = digest({ bytes: "synthetic model" });
export const sourceHash = digest({ bytes: "synthetic source" });

function pngChunk({ type, bytes }: { type: string; bytes: Buffer }) {
	const chunk = Buffer.alloc(bytes.length + 12);
	chunk.writeUInt32BE(bytes.length);
	chunk.write(type, 4, "ascii");
	bytes.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
	return chunk;
}
function encodePng() {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(WIDTH);
	header.writeUInt32BE(HEIGHT, 4);
	header[8] = 8;
	header[9] = 6;
	const scanlines = Buffer.alloc(HEIGHT * (WIDTH * 4 + 1));
	for (let row = 0; row < HEIGHT; row++)
		input.copy(
			scanlines,
			row * (WIDTH * 4 + 1) + 1,
			row * WIDTH * 4,
			(row + 1) * WIDTH * 4
		);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk({ type: "IHDR", bytes: header }),
		pngChunk({ type: "IDAT", bytes: deflateSync(scanlines) }),
		pngChunk({ type: "IEND", bytes: Buffer.alloc(0) }),
	]);
}
export const png = encodePng();
const pngHash = digest({ bytes: png });
const completed = { passed: true, completed: true, failures: [] };
export const frames = [
	"face",
	"motion",
	"mirror",
	"no-face",
	"recovery",
	"zero-effect",
	"half-effect",
].map((label, index) => ({
	label,
	image: "/never/authorize/this/image.png",
	timestamp: index / 30,
	parameters: {
		face_adjust_eye: [
			{ id: -1, intensity: index === 5 ? 0 : index === 6 ? 0.5 : 1 },
		],
	},
	expect_change: index !== 3 && index !== 5,
	image_sha256: pngHash,
	input_rgba_sha256: inputHash,
}));
const comparisons = frames.map((frame, index) => ({
	index,
	equal: true,
	changed_pixels: 0,
	max_delta: 0,
	bbox: null,
	sha256: frame.expect_change ? effectHash : inputHash,
}));
export const exact = { exact: true, max_abs: 0 };

export async function changeJson({
	filename,
	patch,
}: {
	filename: string;
	patch: Record<string, unknown>;
}) {
	await fs.writeFile(
		filename,
		JSON.stringify({
			...JSON.parse(await fs.readFile(filename, "utf8")),
			...patch,
		})
	);
}
export async function relink({
	root,
	legacyProbeHash,
}: {
	root: string;
	legacyProbeHash?: string;
}) {
	const index = JSON.parse(
		await fs.readFile(path.join(root, "index.json"), "utf8")
	);
	const originalFrames = index.format === OWNED_CHAIN_ORIGINAL_FORMAT;
	const fileHash = async ({ filename }: { filename: string }) =>
		digest({ bytes: await fs.readFile(path.join(root, filename)) });
	const reportHash = ({
		key,
	}: {
		key: keyof typeof OWNED_CHAIN_REPORT_FILES;
	}) => fileHash({ filename: OWNED_CHAIN_REPORT_FILES[key] });
	const originalLinks = {
		capture: await reportHash({ key: "originalCapture" }),
		sequence_replay: await reportHash({ key: "originalReplay" }),
		sequence_render: await reportHash({ key: "originalRender" }),
	};
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.originalAudit),
		patch: { report_sha256: originalLinks },
	});
	const originalFixtures = {
		...(originalFrames
			? Object.fromEntries(
					frames.map((_, position) => [
						`/historical/input-${position}.rgba`,
						inputHash,
					])
				)
			: {}),
		"/historical/capture/report.json": originalLinks.capture,
		"/historical/replay/report.json": originalLinks.sequence_replay,
		"/historical/render/report.json": originalLinks.sequence_render,
		"/historical/audit/report.json": await reportHash({ key: "originalAudit" }),
		...Object.fromEntries(
			OWNED_CHAIN_CAPTURE_SOURCES.filter(
				(relative) =>
					legacyProbeHash === undefined ||
					!relative.endsWith("/face_native_process.py")
			).map((relative) => [
				`/historical/research/${relative}`,
				legacyProbeHash && relative.endsWith("/face_preprocess_probe.py")
					? legacyProbeHash
					: sourceHash,
			])
		),
	};
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.capture),
		patch: { fixture_sha256: originalFixtures },
	});
	const capture_sha256 = await reportHash({ key: "capture" });
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.model),
		patch: {
			capture_sha256,
			export_summary_sha256: await reportHash({ key: "summary" }),
		},
	});
	const replay_sha256 = await fileHash({ filename: "replay.json" });
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.candidate),
		patch: {
			capture_sha256,
			model_report_sha256: await reportHash({ key: "model" }),
			replay_sha256,
			fixture_sha256: originalFixtures,
		},
	});
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.render),
		patch: {
			capture_sha256,
			replay_sha256,
			...(originalFrames
				? { candidate_report_sha256: await reportHash({ key: "candidate" }) }
				: {}),
		},
	});
	const reports = await Object.keys(OWNED_CHAIN_REPORT_FILES).reduce(
		(previous, name) =>
			previous.then(async (result) => ({
				...result,
				[name]: await reportHash({
					key: name as keyof typeof OWNED_CHAIN_REPORT_FILES,
				}),
			})),
		Promise.resolve({} as Record<string, string>)
	);
	if (originalFrames) {
		await changeJson({
			filename: path.join(root, "reports/chain-audit.json"),
			patch: {
				capture_sha256,
				replay_sha256,
				candidate_report_sha256: reports.candidate,
				render_report_sha256: reports.render,
				model_report_sha256: reports.model,
				fixture_sha256: {
					...originalFixtures,
					...Object.fromEntries(
						Object.entries(reports).map(([key, value]) => [
							`/audited/${key}.json`,
							value,
						])
					),
				},
			},
		});
		reports.chainAudit = await fileHash({
			filename: "reports/chain-audit.json",
		});
	}
	await changeJson({
		filename: path.join(root, "index.json"),
		patch: { reports, replay_sha256 },
	});
}

export async function originalFixture() {
	const fixtureValue = await fixture();
	const { root, currentSourceRoot } = fixtureValue;
	const read = async ({
		key,
	}: {
		key: keyof typeof OWNED_CHAIN_REPORT_FILES;
	}) =>
		JSON.parse(
			await fs.readFile(path.join(root, OWNED_CHAIN_REPORT_FILES[key]), "utf8")
		);
	const candidate = await read({ key: "candidate" });
	const rendered = await read({ key: "render" });
	const model = await read({ key: "model" });
	const original = await read({ key: "originalCapture" });
	const claims = {
		original_rgba_input_used: true,
		native_algorithm_rgba_required: false,
		native_algorithm_rgba_input_used: false,
		native_algorithm_rgba_oracle_required: true,
		independent_full_frame_preprocessing: true,
		fixed_profile_only: true,
	};
	const request = [0, 640, 480, 2560, 0];
	const initialization = candidate.initialization_sampling_cases.map(
		(row: Record<string, unknown>, inference: number) => ({
			...row,
			inference,
			algorithm_frame_sha256: graphHash,
			generated_tensor_sha256: modelHash,
		})
	);
	const sampling = Array.from({ length: 26 }, (_, prediction) =>
		prediction === 19
			? { prediction, idle: true }
			: {
					prediction,
					inference: prediction < 19 ? prediction : prediction - 1,
					slot: 0,
					active: prediction !== 18,
					sampling_exact: true,
					input_sha256: modelHash,
					algorithm_frame_sha256: graphHash,
					input_source: "original-rgba-staged-q11",
				}
	);
	const preprocessing = {
		algorithm: "staged-q11",
		source_size: [WIDTH, HEIGHT],
		source_stride: WIDTH * 4,
		request,
		...claims,
		native_caller_parameters_required: true,
		arbitrary_frame_backend_connected: false,
		product_parity_verified: false,
		captured_tensor_input_used: false,
		generated_120_inputs: 25,
		generated_160_inputs: 2,
		source_frames: frames.map((_, index) => ({
			index,
			path: `/historical/input-${index}.rgba`,
			original_rgba_sha256: inputHash,
			generated_algorithm_sha256: graphHash,
		})),
		observations: Array.from({ length: 26 }, (_, prediction) => ({
			prediction,
			frame_index: prediction < 14 ? 0 : Math.floor((prediction - 12) / 2),
			request,
			algorithm_exact: true,
			original_rgba_sha256: inputHash,
			generated_algorithm_sha256: graphHash,
			oracle_sha256: graphHash,
		})),
		sampling_cases: sampling,
		initialization_sampling_cases: initialization,
	};
	const sourceMap = ({ names }: { names: string[] }) =>
		Object.fromEntries(names.map((name) => [name, sourceHash]));
	const candidateSources = sourceMap({ names: OWNED_CHAIN_ORIGINAL_SOURCES });
	const renderSources = {
		...candidateSources,
		"local-model-pytorch/face_preprocess_chain_render.py": sourceHash,
	};
	const auditSources = {
		"local-model-pytorch/face_preprocess_chain_audit.py": sourceHash,
	};
	await Object.keys({ ...renderSources, ...auditSources }).reduce(
		(previous, name) =>
			previous.then(() =>
				fs.writeFile(path.join(currentSourceRoot, name), "synthetic source")
			),
		Promise.resolve()
	);
	const newFrames = frames.map((frame, position) => ({
		...frame,
		parameters: JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "features",
				values: {
					face_adjust_eye: position === 5 ? 0 : position === 6 ? 20 : 40,
				},
			})
		),
	}));
	const manifest = JSON.stringify({ version: 1, frames: newFrames });
	const manifestHash = digest({ bytes: manifest });
	await fs.writeFile(path.join(root, "manifest.json"), manifest);
	await changeJson({
		filename: path.join(root, "replay.json"),
		patch: { image_sha256: manifestHash },
	});
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.originalCapture),
		patch: {
			frames: newFrames,
			fixture_sha256: { [original.manifest]: manifestHash },
		},
	});
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.candidate),
		patch: {
			...claims,
			profile: "original-rgba-owned-chain-v1",
			preprocessing,
			source_sha256: candidateSources,
			sampling_cases: sampling,
			initialization_sampling_cases: initialization,
		},
	});
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.render),
		patch: {
			...claims,
			profile: "original-rgba-owned-chain-render-v1",
			source_sha256: renderSources,
			frames: newFrames,
		},
	});
	for (const size of ["120", "160"]) {
		for (const row of model.model_outputs[size].cases)
			Object.assign(row, {
				actual_input_sha256: modelHash,
				replacement_input_sha256: modelHash,
				input_source: "replacement_inputs",
			});
	}
	await changeJson({
		filename: path.join(root, OWNED_CHAIN_REPORT_FILES.model),
		patch: model,
	});
	await fs.writeFile(
		path.join(root, "reports/chain-audit.json"),
		JSON.stringify({
			...completed,
			...claims,
			profile: "original-rgba-owned-chain-audit-v1",
			preprocessing,
			geometry_exact: true,
			final_consumer_parity: true,
			pixel_parity_verified: true,
			external_replay_verified: true,
			native_execution_performed: false,
			inference_performed: false,
			product_parity_verified: false,
			arbitrary_frame_backend_connected: false,
			head_comparisons: 135,
			normalized_conversions: 24,
			source_sha256: auditSources,
			comparisons: rendered.comparisons,
		})
	);
	const index = JSON.parse(
		await fs.readFile(path.join(root, "index.json"), "utf8")
	);
	await changeJson({
		filename: path.join(root, "index.json"),
		patch: {
			format: OWNED_CHAIN_ORIGINAL_FORMAT,
			manifest_sha256: manifestHash,
			source_sha256: {
				...Object.fromEntries(
					Object.entries(index.source_sha256).filter(
						([key]) =>
							![
								"local-model-pytorch/chain.py",
								"local-model-pytorch/render.py",
							].includes(key)
					)
				),
				...renderSources,
				...auditSources,
			},
		},
	});
	await relink({ root });
	return fixtureValue;
}

export async function fixture() {
	const temporary = await fs.realpath(
		await fs.mkdtemp(path.join(tmpdir(), "beauty-owned-chain-"))
	);
	temporaryRoots.push(temporary);
	const root = path.join(temporary, "package");
	const currentSourceRoot = path.join(temporary, "research");
	await fs.mkdir(path.join(root, "reports"), { recursive: true });
	await fs.mkdir(path.join(root, "frames"), { recursive: true });
	await fs.mkdir(path.join(currentSourceRoot, "local-model-pytorch"), {
		recursive: true,
	});
	const originalSources = Object.fromEntries(
		Array.from({ length: 50 }, (_, index) => [
			`local-model-pytorch/file-${index}.py`,
			sourceHash,
		])
	);
	const extraSources = {
		"local-model-pytorch/chain.py": sourceHash,
		"local-model-pytorch/render.py": sourceHash,
		"local-model-pytorch/model.py": sourceHash,
		...Object.fromEntries(
			OWNED_CHAIN_CAPTURE_SOURCES.map((relative) => [relative, sourceHash])
		),
	};
	const source_sha256 = { ...originalSources, ...extraSources };
	await Object.keys(source_sha256).reduce(
		(previous, relative) =>
			previous.then(() =>
				fs.writeFile(path.join(currentSourceRoot, relative), "synthetic source")
			),
		Promise.resolve()
	);
	const manifest = JSON.stringify({ version: 1, frames });
	const manifest_sha256 = digest({ bytes: manifest });
	await fs.writeFile(path.join(root, "manifest.json"), manifest);
	const payload = {
		version: 1,
		width: WIDTH,
		height: HEIGHT,
		coordinate_space: "normalized-bottom-left",
		image_sha256: manifest_sha256,
		frames: Array.from({ length: 24 }, (_, position) => ({
			timestamp_us: Math.round(
				frames[position < 12 ? 0 : Math.floor((position - 10) / 2)].timestamp *
					1000000
			),
			faces:
				position === 16 || position === 17
					? []
					: [
							{
								id: position < 18 ? 0 : 1,
								points: Array.from({ length: 106 }, () => [0.5, 0.5]),
							},
						],
		})),
	};
	await fs.writeFile(path.join(root, "replay.json"), JSON.stringify(payload));
	const check = {
		passed: true,
		max_abs: 0,
		atol: 0.0001,
		rtol: 0.00001,
		relative_limit: null,
	};
	const probability = { ...check, atol: 0.000001, relative_limit: 0.001 };
	const outputs = Object.fromEntries(
		[120, 160].map((size) => [
			String(size),
			{
				graph_sha256: graphHash,
				onnx_sha256: modelHash,
				successful_inferences: size === 120 ? 25 : 2,
				cases: Array.from(
					{ length: size === 120 ? 25 : 2 },
					(_, inference) => ({
						inference,
						passed: true,
						checks: {
							fc_landmark_s1: { ...check, ...exact, elements: 212 },
							fc_visible: probability,
							prob: probability,
							fc_yaw: check,
							fc_pitch: check,
						},
					})
				),
			},
		])
	);
	const reports = {
		capture: {
			passed: true,
			failures: [],
			diagnostic_only: true,
			native_analysis_bypassed: false,
			observer_pixel_parity_verified: true,
			product_parity_verified: false,
			old_sources_verified: 50,
			comparisons,
			fixture_sha256: {},
		},
		candidate: {
			...completed,
			profile: "actual-preprocess-owned-chain-v1",
			diagnostic_only: false,
			geometry_exact: true,
			final_consumer_parity: true,
			captured_tensor_input_used: false,
			native_final_point_input_used: false,
			native_analysis_bypassed: false,
			product_parity_verified: false,
			arbitrary_frame_backend_connected: false,
			independent_full_frame_preprocessing: false,
			independent_120_sampling_input_used: true,
			independent_160_sampling_input_used: true,
			owned_initialization_used: true,
			owned_temporal_smoothing_used: true,
			native_smoothing_seed_predictions: [],
			owned_smoothing_seed_predictions: [0, 20],
			native_smoothing_seed_required: false,
			native_algorithm_rgba_required: true,
			native_caller_parameters_required: true,
			manifest_frames: 7,
			head_comparisons: 135,
			source_sha256: { "local-model-pytorch/chain.py": sourceHash },
			cases: Array.from({ length: 26 }, (_, prediction) => ({
				prediction,
				active_faces: prediction === 18 || prediction === 19 ? 0 : 1,
				published_faces: prediction === 18 || prediction === 19 ? 0 : 1,
			})),
			initialization_sampling_cases: [0, 20].map((prediction) => ({
				prediction,
				passed: true,
				checks: {
					source: exact,
					crop: exact,
					resized: exact,
					tensor: exact,
					post_crop_rect: { exact: true },
				},
			})),
		},
		render: {
			...completed,
			width: WIDTH,
			height: HEIGHT,
			profile: "actual-preprocess-owned-chain-render-v1",
			native_analysis_bypassed: false,
			independent_inference_verified: false,
			product_parity_verified: false,
			arbitrary_frame_backend_connected: false,
			external_replay_verified: true,
			pixel_parity_verified: true,
			source_sha256: { "local-model-pytorch/render.py": sourceHash },
			fixture_sha256: {},
			frames,
			comparisons: comparisons.map((row, index) => ({
				...row,
				baseline_sha256: row.sha256,
				versus_input: {
					equal: !frames[index].expect_change,
					changed_pixels: frames[index].expect_change ? 1 : 0,
					max_delta: frames[index].expect_change ? 1 : 0,
					bbox: frames[index].expect_change ? [0, 0, 1, 1] : null,
					sha256: row.sha256,
				},
			})),
		},
		model: {
			passed: true,
			failures: [],
			expected_comparisons: 7,
			head_comparisons: 135,
			independent_120_sampling_input_used: true,
			independent_160_sampling_input_used: true,
			source_sha256: { "model.py": sourceHash },
			model_outputs: outputs,
		},
		summary: {
			passed: true,
			artifacts: {
				"align-120/artifacts/model.onnx": modelHash,
				"align-160/artifacts/model.onnx": modelHash,
			},
			networks: {
				"120": { graph_sha256: graphHash },
				"160": { graph_sha256: graphHash },
			},
		},
		originalCapture: {
			passed: true,
			failures: [],
			width: WIDTH,
			height: HEIGHT,
			frames,
			comparisons,
			manifest: "/historical/manifest.json",
			fixture_sha256: { "/historical/manifest.json": manifest_sha256 },
			native_analysis_bypassed: false,
			predictions: 26,
			source_sha256: originalSources,
		},
		originalReplay: { ...completed, source_sha256: originalSources },
		originalRender: { ...completed, source_sha256: originalSources },
		originalAudit: {
			...completed,
			source_count: 50,
			source_hashes_verified: true,
			pipeline_parity: true,
		},
	};
	await Object.entries(reports).reduce(
		(previous, [name, value]) =>
			previous.then(() =>
				fs.writeFile(
					path.join(
						root,
						OWNED_CHAIN_REPORT_FILES[name as keyof typeof reports]
					),
					JSON.stringify(value)
				)
			),
		Promise.resolve()
	);
	await frames.reduce(
		(previous, frame, index) =>
			previous.then(async () => {
				const suffix = String(index).padStart(2, "0");
				await fs.writeFile(path.join(root, `frames/input-${suffix}.png`), png);
				await fs.writeFile(
					path.join(root, `frames/native-${suffix}.rgba`),
					frame.expect_change ? effect : input
				);
				await fs.writeFile(
					path.join(root, `frames/candidate-${suffix}.rgba`),
					frame.expect_change ? effect : input
				);
			}),
		Promise.resolve()
	);
	await fs.writeFile(
		path.join(root, "index.json"),
		JSON.stringify({
			format: OWNED_CHAIN_PACKAGE_FORMAT,
			reports: {},
			manifest_sha256,
			replay_sha256: "",
			source_sha256,
			frames: comparisons.map((frame, index) => ({
				index,
				input_png_sha256: pngHash,
				input_rgba_sha256: inputHash,
				native_rgba_sha256: frame.sha256,
				candidate_rgba_sha256: frame.sha256,
			})),
		})
	);
	await relink({ root });
	return {
		temporary,
		root,
		currentSourceRoot,
		provider: createBeautyLabOwnedChainProvider({ root, currentSourceRoot }),
	};
}
