import assert from "node:assert/strict";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider";
import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-contract";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request";
import { compareRgbaPixels } from "../beauty-lab/beauty-lab-rgba-metrics";
import type { PortraitSessionProvider } from "./jianying-portrait-session-plan";
import {
	decodeMinuteVideo,
	openMinuteFrames,
	rgbaHash,
	type MinutePlan,
} from "./jianying-portrait-acceptance-fixture";
import {
	faceSpecificity,
	fixedGainDifference,
} from "./jianying-portrait-acceptance-metrics";
import { runMinuteSeekAcceptance } from "./jianying-portrait-acceptance-seek";

export const writeAcceptanceJson = ({
	file,
	value,
}: {
	file: string;
	value: unknown;
}) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

export async function saveAcceptancePng({
	file,
	pixels,
	width,
	height,
}: {
	file: string;
	pixels: Uint8Array;
	width: number;
	height: number;
}) {
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");
	context.putImageData(
		new ImageData(new Uint8ClampedArray(pixels), width, height),
		0,
		0
	);
	const bytes = canvas.toBuffer("image/png");
	await writeFile(file, bytes, { mode: 0o600 });
	context.drawImage(await loadImage(bytes), 0, 0);
	assert.equal(
		rgbaHash({
			bytes: new Uint8Array(context.getImageData(0, 0, width, height).data),
		}),
		rgbaHash({ bytes: pixels }),
		"PNG roundtrip differs"
	);
	return {
		file: path.basename(file),
		pngSha256: rgbaHash({ bytes }),
		rgbaSha256: rgbaHash({ bytes: pixels }),
	};
}

export async function loadAcceptanceImage({ source }: { source: string }) {
	const bytes = await readFile(source);
	assert(bytes.length <= 32 * 1024 ** 2, "Image fixture exceeds 32 MiB");
	const image = await loadImage(bytes);
	const { width, height } = image;
	assert(
		width > 0 && height > 0 && width * height <= 2_100_000,
		"Image fixture exceeds 2.1MP"
	);
	const context = createCanvas(width, height).getContext("2d");
	context.drawImage(image, 0, 0);
	return {
		width,
		height,
		rgba: new Uint8Array(context.getImageData(0, 0, width, height).data),
		fileSha256: rgbaHash({ bytes }),
	};
}

export async function runMinuteAcceptance({
	source,
	output,
	plan,
}: {
	source: string;
	output: string;
	plan: MinutePlan;
}) {
	const raw = path.join(output, "chronological.rgba");
	const report = {
		passed: false,
		completed: false,
		providerCleared: false,
		nativeExecutionPerformed: true,
		spanSeconds: plan.spanSeconds,
		frameCount: plan.frames.length,
		renderedFrames: 0,
		repeatFrames: 0,
		changedFrames: 0,
		noOpFrames: 0,
		repeatMismatches: 0,
		alphaViolations: 0,
		faceSamples: [] as unknown[],
		seeks: null as Awaited<ReturnType<typeof runMinuteSeekAcceptance>> | null,
		artifacts: [] as unknown[],
		error: null as string | null,
		elapsedMs: 0,
		peakWorkerRss: process.memoryUsage().rss,
		scope:
			"all chronological decoded frames for >=60 seconds, then fresh same-sequence native repeat; not Jianying UI parity or live candidate acceptance",
		noOpPolicy:
			"count every no-op; only sampled independent detections classify no-face; unsampled no-ops remain unclassified",
	};
	const started = performance.now();
	try {
		await decodeMinuteVideo({ source, file: raw, plan });
		const reader = await openMinuteFrames({ file: raw, plan });
		const expectedHashes: string[] = [];
		const samples = new Set([
			0,
			...[10, 20, 30, 40, 50, 60].map((time) =>
				plan.frames.findIndex(
					(frame) => frame.time - plan.frames[0].time >= time
				)
			),
		]);
		const saved = new Map<number, Uint8Array>();
		try {
			await [0, 1].reduce(async (previousPass, pass) => {
				await previousPass;
				const provider: PortraitSessionProvider =
					createJianyingPortraitAdjustmentProvider();
				const detector = createJianyingPortraitAdjustmentProvider();
				try {
					await plan.frames.reduce(async (previous, frame) => {
						await previous;
						const rgba = await reader.read({ index: frame.index });
						assert.equal(
							rgbaHash({ bytes: rgba }),
							frame.sha256,
							"Fresh decode differs from prepared frame"
						);
						const request = {
							width: plan.width,
							height: plan.height,
							rgba,
							sourceKey: `minute:${pass}`,
							frameNumber: frame.index,
							timestampSeconds: frame.time,
							adjustments: {
								enabled: true,
								values: { face_adjust_EnlargeEye: 60 },
							},
						};
						const start = performance.now();
						const result = await provider.render(
							parseJianyingPortraitRenderRequest({ request })
						);
						assert(
							result.width === plan.width && result.height === plan.height,
							"Render dimensions changed"
						);
						const runtimeMs = performance.now() - start;
						const effect = compareRgbaPixels({
							actual: result.rgba,
							expected: rgba,
							width: plan.width,
							height: plan.height,
						});
						const outputHash = rgbaHash({ bytes: result.rgba });
						const repeated =
							pass === 0 || expectedHashes[frame.index] === outputHash;
						if (pass === 0) {
							expectedHashes.push(outputHash);
							report.renderedFrames++;
							if (effect.changedPixels) report.changedFrames++;
							else report.noOpFrames++;
						} else {
							report.repeatFrames++;
							if (!repeated) report.repeatMismatches++;
						}
						if (
							result.rgba.some(
								(value, index) => index % 4 === 3 && value !== rgba[index]
							)
						)
							report.alphaViolations++;
						report.peakWorkerRss = Math.max(
							report.peakWorkerRss,
							process.memoryUsage().rss
						);
						await appendFile(
							path.join(output, "frames.jsonl"),
							`${JSON.stringify({
								pass,
								index: frame.index,
								time: frame.time,
								inputHash: frame.sha256,
								outputHash,
								runtimeMs,
								effect,
								repeated,
							})}\n`,
							{ mode: 0o600 }
						);
						if (samples.has(frame.index)) {
							if (pass === 0) {
								saved.set(frame.index, result.rgba);
								const faces = await detector.detect(request);
								report.faceSamples.push({
									index: frame.index,
									time: frame.time,
									faces: faces.faces,
									classification:
										faces.faces.length === 0
											? "detected-no-face"
											: effect.changedPixels
												? "effect-observed"
												: "detected-face-no-op",
								});
								await saveAcceptancePng({
									file: path.join(output, `${frame.index}-input.png`),
									pixels: rgba,
									width: plan.width,
									height: plan.height,
								});
							}
							const expected = pass === 0 ? rgba : saved.get(frame.index)!;
							const native = await saveAcceptancePng({
								file: path.join(output, `${frame.index}-pass-${pass}.png`),
								pixels: result.rgba,
								width: plan.width,
								height: plan.height,
							});
							const diff = await saveAcceptancePng({
								file: path.join(
									output,
									`${frame.index}-pass-${pass}-diff-x8.png`
								),
								pixels: fixedGainDifference({
									actual: result.rgba,
									expected,
									width: plan.width,
									height: plan.height,
								}),
								width: plan.width,
								height: plan.height,
							});
							report.artifacts.push({ index: frame.index, pass, native, diff });
							console.log(
								JSON.stringify({
									phase: "minute",
									pass,
									frame: frame.index,
									mediaTime: frame.time,
								})
							);
						}
					}, Promise.resolve());
				} finally {
					await provider.clear();
					await detector.clear();
				}
			}, Promise.resolve());
			report.seeks = await runMinuteSeekAcceptance({
				plan,
				readFrame: reader.read,
				createProvider: createJianyingPortraitAdjustmentProvider,
				onSample: async ({ id, actual, expected }) => {
					await saveAcceptancePng({
						file: path.join(output, `${id}-native.png`),
						pixels: actual,
						width: plan.width,
						height: plan.height,
					});
					await saveAcceptancePng({
						file: path.join(output, `${id}-expected.png`),
						pixels: expected,
						width: plan.width,
						height: plan.height,
					});
					await saveAcceptancePng({
						file: path.join(output, `${id}-diff-x8.png`),
						pixels: fixedGainDifference({
							actual,
							expected,
							width: plan.width,
							height: plan.height,
						}),
						width: plan.width,
						height: plan.height,
					});
				},
			});
			report.providerCleared = true;
		} finally {
			await reader.close();
		}
		report.completed = true;
		report.passed =
			report.renderedFrames === plan.frames.length &&
			report.repeatFrames === plan.frames.length &&
			report.changedFrames > 0 &&
			report.repeatMismatches === 0 &&
			report.alphaViolations === 0 &&
			report.seeks?.passed === true &&
			report.providerCleared;
	} catch (cause) {
		report.error = String(cause);
		throw cause;
	} finally {
		report.elapsedMs = performance.now() - started;
		await rm(raw, { force: true });
		await writeAcceptanceJson({
			file: path.join(output, "report.json"),
			value: report,
		});
	}
	return report;
}

export async function runMultifaceAcceptance({
	source,
	output,
}: {
	source: string;
	output: string;
}) {
	const image = await loadAcceptanceImage({ source });
	const provider = createJianyingPortraitAdjustmentProvider();
	const request = {
		...image,
		sourceKey: "multiface-A",
		frameNumber: 0,
		timestampSeconds: 0,
	};
	const report = {
		passed: false,
		completed: false,
		providerCleared: false,
		staticMultifaceOnly: true,
		dynamicMultifaceVerified: false,
		sourceSha256: image.fileSha256,
		cases: [] as unknown[],
		identities: [] as unknown[],
		error: null as string | null,
	};
	const checks: boolean[] = [];
	try {
		const detection = await provider.detect(request);
		assert(
			detection.faces.length >= 2 && detection.faces.length <= 5,
			"Expected 2..5 real detected faces"
		);
		report.identities.push({ phase: "initial", ...detection });
		const bindings = detection.faces.map(({ personBindingId, rect }) => ({
			personBindingId,
			anchor: { rect, frameNumber: 0 },
		}));
		const run = async ({
			selected,
			id,
		}: {
			selected: typeof detection.faces;
			id: string;
		}) => {
			const adjustments: MediaPortraitAdjustments = {
				enabled: true,
				values: {},
				faces: selected.map((face) => ({
					trackId: face.trackId,
					personBindingId: face.personBindingId,
					bindingAnchor: { rect: face.rect, frameNumber: 0 },
					values: {},
					makeup: { lip: { cardId: "lip-soft-pink", intensity: 80 } },
				})),
			};
			const actual = await provider.render(
				parseJianyingPortraitRenderRequest({
					request: { ...request, adjustments },
				})
			);
			const check = faceSpecificity({
				actual: actual.rgba,
				original: image.rgba,
				faces: detection.faces,
				selectedIds: selected.map(({ personBindingId }) => personBindingId),
				width: image.width,
				height: image.height,
			});
			const paused = await provider.render(
				parseJianyingPortraitRenderRequest({
					request: { ...request, adjustments },
				})
			);
			const pauseExact =
				rgbaHash({ bytes: paused.rgba }) === rgbaHash({ bytes: actual.rgba });
			const artifact = await saveAcceptancePng({
				file: path.join(output, `${id}-native.png`),
				pixels: actual.rgba,
				...image,
			});
			const diff = await saveAcceptancePng({
				file: path.join(output, `${id}-diff-x8.png`),
				pixels: fixedGainDifference({
					actual: actual.rgba,
					expected: image.rgba,
					...image,
				}),
				...image,
			});
			checks.push(check.passed && pauseExact);
			report.cases.push({ id, ...check, pauseExact, artifact, diff });
		};
		await run({ selected: [detection.faces[0]], id: "face-A" });
		await run({ selected: [detection.faces[1]], id: "face-B" });
		await run({ selected: [detection.faces[0]], id: "face-A-revisit" });
		await run({ selected: detection.faces, id: "all-faces" });
		await provider.clear();
		const rebound = await provider.detect({
			...request,
			sourceKey: "multiface-B",
			personBindings: bindings,
		});
		report.identities.push({ phase: "source-change-and-clear", ...rebound });
		checks.push(
			rebound.faces.length === detection.faces.length &&
				rebound.unmatchedPersonBindingIds.length === 0 &&
				rebound.faces.every(({ bindingStatus }) => bindingStatus === "matched")
		);
		request.sourceKey = "multiface-B";
		detection.faces = rebound.faces;
		await run({ selected: [rebound.faces[0]], id: "source-B-face-A" });
		const zero = await provider.render({
			...request,
			adjustments: { enabled: true, values: {} },
		});
		const zeroExact =
			rgbaHash({ bytes: zero.rgba }) === rgbaHash({ bytes: image.rgba });
		checks.push(zeroExact);
		report.cases.push({ id: "zero-control", zeroExact });
		report.completed = true;
	} catch (cause) {
		report.error = String(cause);
		throw cause;
	} finally {
		try {
			await provider.clear();
			report.providerCleared = true;
		} finally {
			report.passed =
				report.completed &&
				report.providerCleared &&
				checks.length === 7 &&
				checks.every(Boolean);
			await writeAcceptanceJson({
				file: path.join(output, "report.json"),
				value: report,
			});
		}
	}
	return report;
}
