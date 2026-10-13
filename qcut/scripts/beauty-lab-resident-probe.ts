import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createBeautyLabIndependentProvider } from "../electron/beauty-lab/beauty-lab-independent";
import { runIndependentBeautyJob } from "../electron/beauty-lab/beauty-lab-independent-process";
import { createJianyingPortraitAdjustmentProvider } from "../electron/jianying-portrait-adjustment-runtime/provider";
import type { MediaPortraitAdjustments } from "../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";
import {
	comparePixels,
	cropVertical,
	exactOutput,
	readFrame,
	requireProbe,
	residentIdentity,
	saveFrame,
	serial,
	sha256,
	writeJson,
	type ProbeFrame,
} from "./beauty-lab-resident-probe-utils";

import {
	benchmark,
	interruption,
	timedRender,
} from "./beauty-lab-resident-probe-runs";

interface ProbeCase {
	name: string;
	adjustments: MediaPortraitAdjustments;
}
const SKIN: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_Smooth: 30, face_adjust_Whiten: 45 },
};
const COMPOSITE: MediaPortraitAdjustments = {
	enabled: true,
	values: { ...SKIN.values, face_adjust_TotalFace: 35, face_adjust_Nose: 25 },
	makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
};
const CASES: ProbeCase[] = [
	{
		name: "eye",
		adjustments: { enabled: true, values: { face_adjust_EnlargeEye: 60 } },
	},
	{ name: "skin", adjustments: SKIN },
	{ name: "composite", adjustments: COMPOSITE },
];

async function main() {
	const [photo, hdPhoto, output, ...extra] = process.argv.slice(2);
	if (!photo || !hdPhoto || !output || extra.length)
		throw new Error(
			"Usage: node <compiled-resident-probe.cjs> <photo.png> <hdPhoto.png> <fresh-output-directory>; first bundle this entry with esbuild --platform=node --format=cjs --packages=external"
		);
	const directory = path.resolve(output);
	await mkdir(directory, { recursive: false });
	const engineRoot = path.resolve("research/independent-beauty");
	const configuration = {
		engineRoot,
		runtimeRoot:
			process.env.QCUT_INDEPENDENT_BEAUTY_RUNTIME ??
			path.join(engineRoot, "runtime"),
		python:
			process.env.QCUT_INDEPENDENT_BEAUTY_PYTHON ??
			path.join(engineRoot, "research/.venv/bin/python"),
	};
	const oneShot = createBeautyLabIndependentProvider({
		...configuration,
		runJob: runIndependentBeautyJob,
	});
	const resident = createBeautyLabIndependentProvider(configuration);
	const native = createJianyingPortraitAdjustmentProvider();
	const failures: { name: string; error: string }[] = [];
	const benchmarks: Record<string, unknown>[] = [],
		recoveries: Record<string, unknown>[] = [],
		nativeCases: Record<string, unknown>[] = [];
	let complete = false;
	const summary = () => ({
		configuration,
		complete,
		failures,
		benchmarks,
		recoveries,
		nativeCases,
		functionalPassed:
			complete &&
			failures.length === 0 &&
			benchmarks.length === 3 &&
			recoveries.length === 3 &&
			benchmarks.every((entry) => entry.exact === true) &&
			recoveries.every((entry) => entry.passed === true),
		nativeGatePassed:
			complete &&
			nativeCases.length === 3 &&
			nativeCases.every((entry) => entry.withinOneRgb === true),
		timingScope:
			"Initial inspect excluded; render includes fresh integrity checks, PNG encode/decode, planner, inference and Metal subprocesses; output saving excluded; no frame cache",
		nativeProductParityVerified: false,
	});
	try {
		const [loaded, hdLoaded] = await Promise.all([
			readFrame({ file: photo, maxEdge: 1280 }),
			readFrame({ file: hdPhoto, maxEdge: 4096 }),
		]);
		const frame: ProbeFrame = {
			width: loaded.width,
			height: loaded.height,
			rgba: loaded.rgba,
		};
		const hdFrame: ProbeFrame = {
			width: hdLoaded.width,
			height: hdLoaded.height,
			rgba: hdLoaded.rgba,
		};
		const { crop, ...vertical } = cropVertical({ frame: hdFrame });
		await writeJson({
			directory,
			name: "sources",
			value: {
				photo: { ...loaded, rgba: undefined },
				hdPhoto: { ...hdLoaded, rgba: undefined },
				vertical: { crop, rgbaSha256: sha256({ bytes: vertical.rgba }) },
			},
		});
		await Promise.all([
			saveFrame({ directory, name: "original", frame }),
			saveFrame({ directory, name: "hd-original", frame: hdFrame }),
			saveFrame({ directory, name: "vertical-original", frame: vertical }),
		]);
		const statuses = await Promise.all([
			oneShot.inspect(),
			resident.inspect(),
			native.inspect(),
		]);
		await writeJson({ directory, name: "status", value: statuses });
		requireProbe({
			condition: statuses.every((status) => status.available),
			message:
				"Both independent modes and the real native provider must be available",
		});
		let composite: Awaited<ReturnType<typeof benchmark>> | undefined;
		await serial({
			entries: CASES,
			run: async (test) => {
				try {
					const row = await benchmark({
						test,
						frame,
						oneShot,
						resident,
						directory,
					});
					benchmarks.push(row.summary);
					if (test.name === "composite") composite = row;
				} catch (error) {
					failures.push({ name: test.name, error: String(error) });
				}
				await writeJson({ directory, name: "summary", value: summary() });
			},
		});
		if (composite) {
			let prior = composite.last;
			const reference = composite.reference;
			await serial({
				entries: ["cancel", "crash"] as ("cancel" | "crash")[],
				run: async (mode) => {
					try {
						const row = await interruption({
							mode,
							provider: resident,
							frame,
							reference,
							prior,
							adjustments: COMPOSITE,
							directory,
						});
						recoveries.push(row.summary);
						prior = row.result;
					} catch (error) {
						failures.push({ name: mode, error: String(error) });
					}
					await writeJson({ directory, name: "summary", value: summary() });
				},
			});
		}
		const hdCases = [
			{
				name: "vertical-smooth",
				frame: vertical,
				adjustments: { enabled: true, values: { face_adjust_Smooth: 30 } },
			},
			{
				name: "vertical-whiten",
				frame: vertical,
				adjustments: { enabled: true, values: { face_adjust_Whiten: 45 } },
			},
			{ name: "hd-composite", frame: hdFrame, adjustments: COMPOSITE },
		];
		await serial({
			entries: hdCases,
			run: async (test) => {
				try {
					const owned = await timedRender({
						provider: resident,
						...test,
						directory,
					});
					const started = performance.now();
					const baseline = await native.render({
						...test.frame,
						adjustments: test.adjustments,
						sourceKey: test.name,
						frameNumber: 0,
						timestampSeconds: 0,
						freshTracking: true,
					});
					const nativeMs = performance.now() - started;
					requireProbe({
						condition:
							baseline.provider === "jianying-local-swing-v1" &&
							baseline.width === test.frame.width &&
							baseline.height === test.frame.height,
						message: "Native provider identity or output dimensions changed",
					});
					const { metrics, difference } = comparePixels({
						actual: owned.result,
						expected: baseline,
					});
					const { rgba: nativePixels, ...nativeReport } = baseline;
					const row = {
						name: test.name,
						width: test.frame.width,
						height: test.frame.height,
						adjustments: test.adjustments,
						independentMs: owned.milliseconds,
						nativeMs,
						...metrics,
						originalSha256: sha256({ bytes: test.frame.rgba }),
						independentSha256: owned.result.outputSha256,
						nativeSha256: sha256({ bytes: nativePixels }),
						nativeReport,
						freshTracking: true,
						residentRuntime: residentIdentity({ result: owned.result }),
						nativeProductParityVerified: false,
					};
					await Promise.all([
						saveFrame({
							directory,
							name: `${test.name}-source`,
							frame: test.frame,
						}),
						saveFrame({
							directory,
							name: `${test.name}-native`,
							frame: baseline,
						}),
						saveFrame({
							directory,
							name: `${test.name}-difference-x4`,
							frame: { ...test.frame, rgba: difference },
						}),
						writeJson({
							directory,
							name: `${test.name}-comparison`,
							value: row,
						}),
					]);
					nativeCases.push(row);
					console.log(JSON.stringify({ phase: "native-comparison", ...row }));
				} catch (error) {
					failures.push({ name: test.name, error: String(error) });
				}
				await writeJson({ directory, name: "summary", value: summary() });
			},
		});
		if (composite) {
			const afterHd = await timedRender({
				provider: resident,
				frame,
				adjustments: COMPOSITE,
				name: "preview-after-hd",
				directory,
			});
			const equality = exactOutput({
				actual: afterHd.result,
				expected: composite.reference,
			});
			const row = {
				mode: "original-to-preview",
				passed: Object.values(equality).every(Boolean),
				equality,
				residentRuntime: residentIdentity({ result: afterHd.result }),
			};
			recoveries.push(row);
			await writeJson({
				directory,
				name: "preview-after-hd-comparison",
				value: row,
			});
		}
		complete = true;
	} catch (error) {
		failures.push({ name: "setup", error: String(error) });
	} finally {
		const disposal = await Promise.allSettled([
			oneShot.dispose(),
			resident.dispose(),
			native.clear(),
		]);
		for (const item of disposal)
			if (item.status === "rejected")
				failures.push({ name: "cleanup", error: String(item.reason) });
		await writeJson({ directory, name: "summary", value: summary() });
	}
	const result = summary();
	console.log(
		JSON.stringify({
			output: directory,
			functionalPassed: result.functionalPassed,
			nativeGatePassed: result.nativeGatePassed,
			failures,
		})
	);
	process.exitCode = result.functionalPassed
		? result.nativeGatePassed
			? 0
			: 2
		: 1;
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
