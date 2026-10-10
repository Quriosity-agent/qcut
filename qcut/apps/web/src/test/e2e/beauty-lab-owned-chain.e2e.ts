import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, test } from "@playwright/test";
import {
	OWNED_CHAIN_ORIGINAL_FORMAT,
	ownedChainIndexSchema,
	ownedChainRenderSchema,
} from "../../../../../electron/beauty-lab/beauty-lab-owned-chain-evidence";
import { resolveBeautyLabResearchPaths } from "../../../../../electron/beauty-lab-research-config";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { saveBeautyLabComparison } from "./helpers/beauty-lab-comparison";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const packageRoot = resolveBeautyLabResearchPaths({
	sourceRoot: path.resolve("."),
	isPackaged: false,
	environment: process.env,
}).ownedChainRoot!;
const output = path.resolve(
	process.env.QCUT_BEAUTY_OWNED_CHAIN_OUTPUT ??
		"output/playwright/beauty-lab-owned-chain"
);
const optionLabel =
	process.env.QCUT_BEAUTY_OWNED_CHAIN_OPTION_LABEL ?? "自有采样对照";

function digest({ bytes }: { bytes: Uint8Array }) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function decodePixels({ bytes }: { bytes: Buffer }) {
	const image = await loadImage(bytes);
	const canvas = createCanvas(image.width, image.height);
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	return {
		width: image.width,
		height: image.height,
		pixels: Buffer.from(
			context.getImageData(0, 0, image.width, image.height).data
		),
	};
}

function pixelMetrics({
	actual,
	reference,
	width,
	height,
}: {
	actual: Uint8Array;
	reference: Uint8Array;
	width: number;
	height: number;
}) {
	expect(actual.length).toBe(width * height * 4);
	expect(reference.length).toBe(actual.length);
	let changedPixels = 0,
		rgbTotal = 0,
		rgbMax = 0,
		alphaMax = 0;
	let left = width,
		top = height,
		right = 0,
		bottom = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const rgb = [0, 1, 2].map((channel) =>
			Math.abs(actual[offset + channel] - reference[offset + channel])
		);
		const alpha = Math.abs(actual[offset + 3] - reference[offset + 3]);
		const maximum = Math.max(...rgb);
		rgbTotal += rgb[0] + rgb[1] + rgb[2];
		rgbMax = Math.max(rgbMax, maximum);
		alphaMax = Math.max(alphaMax, alpha);
		if (maximum || alpha) {
			changedPixels++;
			const x = (offset / 4) % width,
				y = Math.floor(offset / 4 / width);
			left = Math.min(left, x);
			top = Math.min(top, y);
			right = Math.max(right, x + 1);
			bottom = Math.max(bottom, y + 1);
		}
	}
	return {
		changedPixels,
		pixelCount: width * height,
		rgbMae: rgbTotal / (width * height * 3),
		rgbMax,
		alphaMax,
		bbox: changedPixels ? [left, top, right, bottom] : null,
	};
}

async function expectedPackage() {
	const pinned = new Map<string, string>();
	const read = async ({
		relative,
		expected,
	}: {
		relative: string;
		expected?: string;
	}) => {
		const bytes = await readFile(path.join(packageRoot, relative));
		const hash = digest({ bytes });
		if (expected !== undefined) expect(hash).toBe(expected);
		pinned.set(relative, hash);
		return bytes;
	};
	const index = ownedChainIndexSchema.parse(
		JSON.parse((await read({ relative: "index.json" })).toString())
	);
	const original = index.format === OWNED_CHAIN_ORIGINAL_FORMAT;
	const profile = original ? "original" : "legacy";
	if (process.env.QCUT_BEAUTY_OWNED_CHAIN_PROFILE !== undefined)
		expect(profile).toBe(process.env.QCUT_BEAUTY_OWNED_CHAIN_PROFILE);
	const render = ownedChainRenderSchema.parse(
		JSON.parse(
			(
				await read({
					relative: "reports/render.json",
					expected: index.reports.render,
				})
			).toString()
		)
	);
	expect(render.profile).toBe(
		original
			? "original-rgba-owned-chain-render-v1"
			: "actual-preprocess-owned-chain-render-v1"
	);
	const frames = await index.frames.reduce(
		(previous, row) =>
			previous.then(async (result) => {
				const suffix = String(row.index).padStart(2, "0");
				const png = await read({
					relative: `frames/input-${suffix}.png`,
					expected: row.input_png_sha256,
				});
				const input = await decodePixels({ bytes: png });
				expect([input.width, input.height]).toEqual([1448, 1086]);
				expect(digest({ bytes: input.pixels })).toBe(row.input_rgba_sha256);
				const native = await read({
					relative: `frames/native-${suffix}.rgba`,
					expected: row.native_rgba_sha256,
				});
				const candidate = await read({
					relative: `frames/candidate-${suffix}.rgba`,
					expected: row.candidate_rgba_sha256,
				});
				expect(native.equals(candidate)).toBe(true);
				const metrics = pixelMetrics({
					actual: native,
					reference: input.pixels,
					width: input.width,
					height: input.height,
				});
				const recorded = render.comparisons[row.index].versus_input;
				expect(metrics.changedPixels).toBe(recorded.changed_pixels);
				expect(Math.max(metrics.rgbMax, metrics.alphaMax)).toBe(
					recorded.max_delta
				);
				expect(metrics.bbox).toEqual(recorded.bbox);
				if (row.index === 3 || row.index === 5)
					expect(metrics.changedPixels).toBe(0);
				else expect(metrics.changedPixels).toBeGreaterThan(0);
				return [
					...result,
					{
						...row,
						...metrics,
						eyeIntensity:
							render.frames[row.index].parameters.face_adjust_eye[0].intensity *
							100,
					},
				];
			}),
		Promise.resolve(
			[] as Array<
				(typeof index.frames)[number] &
					ReturnType<typeof pixelMetrics> & { eyeIntensity: number }
			>
		)
	);
	return {
		frames,
		profile,
		indexSha256: pinned.get("index.json"),
		caseName: original
			? "Original RGBA Owned Chain Research Replay"
			: "Owned Preprocess Research Replay",
		verifyUnchanged: () =>
			[...pinned].reduce(
				(previous, [relative, expected]) =>
					previous.then(async () => {
						expect(
							digest({
								bytes: await readFile(path.join(packageRoot, relative)),
							})
						).toBe(expected);
					}),
				Promise.resolve()
			),
	};
}

test("Beauty Lab owned package CPU oracle: independent seven-frame pixel checks", async () => {
	test.skip(
		!existsSync(path.join(packageRoot, "index.json")),
		"Requires the private owned-chain export"
	);
	const expected = await expectedPackage();
	await expected.verifyUnchanged();
	await mkdir(output, { recursive: true });
	await writeFile(
		path.join(output, "cpu-oracle.json"),
		JSON.stringify(
			{
				passed: true,
				scope: "CPU-export-pixel-oracle-only",
				profile: expected.profile,
				indexSha256: expected.indexSha256,
				packageRoot,
				frames: expected.frames,
				electronLaunched: false,
				nativeExecutionPerformed: false,
				actualUiVerified: false,
			},
			null,
			2
		)
	);
});

test("Beauty Lab owned sampling checkpoint: seven real frames, grayscale, ZIP and isolation", async () => {
	test.skip(
		!source ||
			!existsSync(source) ||
			!existsSync(path.join(packageRoot, "index.json")),
		"Requires the private verified fixed-profile package"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing portrait input");
	const expected = await expectedPackage();
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-owned-chain-")
	);
	const app = await startElectronApp({ userDataDirectory });
	try {
		const page = await getMainWindow(app);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		const timeline = () =>
			page.evaluate(() =>
				JSON.stringify(
					(window as unknown as ReferenceWindow).__timelineStore.getState()
						.tracks
				)
			);
		const before = await timeline();
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		await expect(lab).toBeVisible();
		await expect
			.poll(
				async () =>
					page.evaluate(async () =>
						(await window.electronAPI!.beautyLab!.listResearchCases()).map(
							(item) => ({
								id: item.id,
								name: item.name,
								frameCount: item.frameCount,
							})
						)
					),
				{ timeout: 60_000 }
			)
			.toContainEqual({
				id: "owned-preprocess",
				name: expected.caseName,
				frameCount: 7,
			});
		await lab.getByLabel("对照来源", { exact: true }).click();
		await page.getByRole("option", { name: optionLabel, exact: true }).click();
		const metrics = [];
		for (let index = 0; index < 7; index++) {
			if (index > 0) {
				await lab.getByLabel("记录帧", { exact: true }).click();
				await page
					.getByRole("option", { name: `帧 ${index}`, exact: true })
					.click();
			}
			await expect(
				lab.getByRole("status", { name: "实验室状态" })
			).toContainText(`owned-preprocess:${index}`, { timeout: 60_000 });
			await expect
				.poll(() =>
					lab
						.getByRole("img", {
							name: "原生基准（记录） → 新链路（离线回放）",
							exact: true,
						})
						.evaluate((node) => {
							const canvas = node as HTMLCanvasElement;
							const data = canvas
								.getContext("2d")!
								.getImageData(0, 0, canvas.width, canvas.height).data;
							return data.every(
								(value, offset) => value === (offset % 4 === 3 ? 255 : 0)
							);
						})
				)
				.toBe(true);
			const frame = await page.evaluate(async (frameIndex) => {
				const result = await window.electronAPI!.beautyLab!.loadResearchFrame({
					caseId: "owned-preprocess",
					frameIndex,
				});
				const sha256 = async ({ bytes }: { bytes: Uint8Array }) =>
					Array.from(
						new Uint8Array(
							await crypto.subtle.digest(
								"SHA-256",
								new Uint8Array(bytes).buffer
							)
						),
						(value) => value.toString(16).padStart(2, "0")
					).join("");
				let changedPixels = 0;
				for (let offset = 0; offset < result.input.length; offset += 4) {
					if (
						[0, 1, 2, 3].some(
							(channel) =>
								result.input[offset + channel] !==
								result.native[offset + channel]
						)
					)
						changedPixels++;
				}
				return {
					frameIndex,
					changedPixels,
					width: result.width,
					height: result.height,
					parity: result.native.every(
						(value, offset) => value === result.candidate[offset]
					),
					byteLengths: [
						result.input.length,
						result.native.length,
						result.candidate.length,
					],
					inputSha256: await sha256({ bytes: result.input }),
					nativeSha256: await sha256({ bytes: result.native }),
					candidateSha256: await sha256({ bytes: result.candidate }),
					sourceHashesVerified: result.sourceHashesVerified,
					adjustments: result.adjustments,
					source: result.source,
					nativeDependencies: result.nativeDependencies,
				};
			}, index);
			expect(frame).toMatchObject({
				width: 1448,
				height: 1086,
				parity: true,
				source: "verified-offline-replay",
				nativeDependencies: true,
				sourceHashesVerified: true,
				byteLengths: [1448 * 1086 * 4, 1448 * 1086 * 4, 1448 * 1086 * 4],
				inputSha256: expected.frames[index].input_rgba_sha256,
				nativeSha256: expected.frames[index].native_rgba_sha256,
				candidateSha256: expected.frames[index].candidate_rgba_sha256,
				adjustments: {
					enabled: expected.frames[index].eyeIntensity !== 0,
					values: { face_adjust_eye: expected.frames[index].eyeIntensity },
				},
			});
			expect(frame.changedPixels).toBe(expected.frames[index].changedPixels);
			metrics.push(frame);
			await page.screenshot({
				path: path.join(output, `frame-${index}.png`),
				animations: "disabled",
			});
		}
		const controls = lab.getByTestId("beauty-lab-controls");
		await expect(
			controls.getByRole("button", { name: "识别人脸", exact: true })
		).toBeDisabled();
		await controls.getByRole("button", { name: "美妆", exact: true }).click();
		const makeup = controls.getByTestId("portrait-section-makeup");
		await makeup.getByRole("tab", { name: "口红", exact: true }).click();
		await expect(
			makeup.getByRole("tab", { name: "口红", exact: true })
		).toHaveAttribute("aria-selected", "true");
		await expect(
			makeup.getByRole("button", { name: "柔和粉", exact: true })
		).toBeDisabled();
		await expect(
			makeup.getByRole("button", { name: "无", exact: true })
		).toBeDisabled();
		await expect(makeup.getByLabel("程度数值", { exact: true })).toBeDisabled();
		await page.screenshot({
			path: path.join(output, "read-only-makeup.png"),
			animations: "disabled",
		});
		const zip = await saveBeautyLabComparison({
			app,
			page,
			destination: path.join(output, "owned-chain-comparison.zip"),
		});
		const report = JSON.parse(
			await zip.file("comparison.json")!.async("string")
		);
		expect(report.record).toEqual({
			caseId: "owned-preprocess",
			frameIndex: 6,
		});
		expect(report.mode).toBe("verified-offline-replay");
		expect(report.arbitraryFrameCandidateReady).toBe(false);
		expect(report.candidateProvenance).toBeNull();
		expect(report.nativeDependencies).toBe(true);
		expect(report.adjustments).toEqual({
			enabled: true,
			values: { face_adjust_eye: expected.frames[6].eyeIntensity },
		});
		expect(
			Number.isInteger(report.gain) && report.gain >= 1 && report.gain <= 32
		).toBe(true);
		const zipFrames: Record<
			string,
			Awaited<ReturnType<typeof decodePixels>>
		> = {};
		await ["original", "native", "candidate"].reduce(
			(previous, name) =>
				previous.then(async () => {
					const file = zip.file(`${name}.png`);
					expect(file).not.toBeNull();
					const frame = await decodePixels({
						bytes: await file!.async("nodebuffer"),
					});
					expect([frame.width, frame.height]).toEqual([1448, 1086]);
					const hashes = {
						original: expected.frames[6].input_rgba_sha256,
						native: expected.frames[6].native_rgba_sha256,
						candidate: expected.frames[6].candidate_rgba_sha256,
					};
					expect(digest({ bytes: frame.pixels })).toBe(
						hashes[name as keyof typeof hashes]
					);
					zipFrames[name] = frame;
				}),
			Promise.resolve()
		);
		const pairs = [
			["original", "native"],
			["original", "candidate"],
			["native", "candidate"],
		];
		const zipMetrics = await pairs.reduce(
			(previous, [reference, candidate]) =>
				previous.then(async (rows) => {
					const name = `${reference}-${candidate}`;
					const actual = zipFrames[candidate].pixels,
						input = zipFrames[reference].pixels;
					const { bbox: _bbox, ...comparison } = pixelMetrics({
						actual,
						reference: input,
						width: 1448,
						height: 1086,
					});
					const file = zip.file(`difference-${name}.png`);
					expect(file).not.toBeNull();
					const difference = await decodePixels({
						bytes: await file!.async("nodebuffer"),
					});
					expect([difference.width, difference.height]).toEqual([1448, 1086]);
					let incorrectPixels = 0;
					for (let offset = 0; offset < input.length; offset += 4) {
						const delta = Math.max(
							...[0, 1, 2].map((channel) =>
								Math.abs(input[offset + channel] - actual[offset + channel])
							)
						);
						const gray = Math.min(255, delta * report.gain);
						if (
							[0, 1, 2].some(
								(channel) => difference.pixels[offset + channel] !== gray
							) ||
							difference.pixels[offset + 3] !== 255
						)
							incorrectPixels++;
					}
					expect(incorrectPixels).toBe(0);
					return [...rows, { name, ...comparison }];
				}),
			Promise.resolve(
				[] as Array<
					{ name: string } & Omit<ReturnType<typeof pixelMetrics>, "bbox">
				>
			)
		);
		expect(report.comparisons).toEqual(zipMetrics);
		await page.setViewportSize({ width: 390, height: 844 });
		await lab
			.getByRole("img", { name: "新链路（离线回放）", exact: true })
			.scrollIntoViewIfNeeded();
		expect(
			await lab.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
		).toBe(true);
		await page.screenshot({
			path: path.join(output, "mobile.png"),
			animations: "disabled",
		});
		expect(await timeline()).toBe(before);
		expect(
			await page.evaluate(async () =>
				window.electronAPI!.beautyLab!.inspectCandidate()
			)
		).toMatchObject({
			available: false,
			state: "not-connected",
			backendVersion: null,
		});
		expect(errors).toEqual([]);
		await expected.verifyUnchanged();
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					passed: true,
					profile: expected.profile,
					packageRoot,
					indexSha256: expected.indexSha256,
					caseName: expected.caseName,
					optionLabel,
					independentPixelVerification: true,
					packageUnchanged: true,
					metrics,
					recordReport: report,
					timelineUnchanged: true,
					arbitraryFrameBackendConnected: false,
					pageErrors: errors,
				},
				null,
				2
			)
		);
	} finally {
		await app.close();
	}
});
