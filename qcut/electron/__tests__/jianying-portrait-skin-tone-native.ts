// Bundle as CommonJS and run on Node >=22; the native catalog requires node:sqlite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { compareRgbaPixels } from "../beauty-lab/beauty-lab-rgba-metrics";
import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../jianying-portrait-adjustment-runtime/skin-tone-catalog";

function sha256({ bytes }: { bytes: Uint8Array }) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
	const [input, destination] = process.argv.slice(2);
	assert(
		input && destination,
		"Expected input image and a fresh output directory"
	);
	const source = path.resolve(input);
	const output = path.resolve(destination);
	const sourceBytes = await readFile(source);
	const decoded = await loadImage(source);
	const { width, height } = decoded;
	assert(
		width * height <= 16_000_000,
		"Use a pre-sized fixture within the native input limit"
	);
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");
	context.drawImage(decoded, 0, 0);
	const original = new Uint8Array(
		context.getImageData(0, 0, width, height).data
	);
	assert(
		original.every((value, index) => index % 4 !== 3 || value === 255),
		"This audit requires an opaque fixture"
	);
	await mkdir(output);
	const save = async ({ name, rgba }: { name: string; rgba: Uint8Array }) => {
		context.putImageData(
			new ImageData(new Uint8ClampedArray(rgba), width, height),
			0,
			0
		);
		const png = canvas.toBuffer("image/png");
		await writeFile(path.join(output, name), png);
		const saved = await loadImage(png);
		context.drawImage(saved, 0, 0);
		assert.deepEqual(
			new Uint8Array(context.getImageData(0, 0, width, height).data),
			rgba,
			"Saved PNG must retain exact pixels"
		);
	};
	const diff = ({
		actual,
		expected,
	}: {
		actual: Uint8Array;
		expected: Uint8Array;
	}) => {
		const rgba = new Uint8Array(original.length);
		for (let offset = 0; offset < rgba.length; offset += 4) {
			const gray = Math.min(
				255,
				8 *
					Math.max(
						...[0, 1, 2].map((channel) =>
							Math.abs(actual[offset + channel] - expected[offset + channel])
						)
					)
			);
			rgba.set([gray, gray, gray, 255], offset);
		}
		return rgba;
	};
	const provider = createJianyingPortraitAdjustmentProvider();
	const samples: Record<string, unknown>[] = [];
	const artifacts = new Map<string, Uint8Array>();
	const report: Record<string, unknown> = {
		passed: false,
		source,
		sourceSha256: sha256({ bytes: sourceBytes }),
		width,
		height,
		originalRgbaSha256: sha256({ bytes: original }),
		backend: "real-native",
		gain: 8,
		jianyingUiComparisonPerformed: false,
		arbitraryFrameCandidateReady: false,
		samples,
	};
	const render = async ({
		name,
		skinToneResourceId,
		intensity = 60,
		warmth = 0,
	}: {
		name: string;
		skinToneResourceId?: MediaPortraitAdjustments["skinToneResourceId"];
		intensity?: number;
		warmth?: number;
	}) => {
		const resolution =
			skinToneResourceId === null
				? null
				: await resolveJianyingPortraitPackage({
						runtimePackage: "skin-tone",
						skinToneResourceId,
					});
		const lut = resolution?.packagePath
			? path.join(
					resolution.packagePath,
					"AmazingFeature/image/filter_skin.png"
				)
			: null;
		const lutBefore = lut ? sha256({ bytes: await readFile(lut) }) : null;
		const adjustments: MediaPortraitAdjustments = {
			enabled: true,
			values: {
				face_adjust_skin_Intensity: intensity,
				face_adjust_skin_ColdWarm: warmth,
			},
			...(skinToneResourceId === undefined ? {} : { skinToneResourceId }),
		};
		const request = parseJianyingPortraitRenderRequest({
			request: {
				width,
				height,
				rgba: original,
				sourceKey: `skin-audit:${report.originalRgbaSha256}`,
				frameNumber: 0,
				timestampSeconds: 0,
				adjustments,
			},
		});
		const result = await provider.render(request);
		assert.equal(result.width, width);
		assert.equal(result.height, height);
		assert(
			result.rgba.every(
				(value, index) => index % 4 !== 3 || value === original[index]
			),
			"Alpha changed"
		);
		const metrics = compareRgbaPixels({
			actual: result.rgba,
			expected: original,
			width,
			height,
		});
		if (skinToneResourceId === null || (intensity === 0 && warmth === 0))
			assert.equal(metrics.changedPixels, 0);
		else assert(metrics.changedPixels > 0, `${name} produced no native effect`);
		await save({ name: `${name}-native.png`, rgba: result.rgba });
		await save({
			name: `${name}-diff-x8.png`,
			rgba: diff({ actual: result.rgba, expected: original }),
		});
		if (lut)
			assert.equal(
				sha256({ bytes: await readFile(lut) }),
				lutBefore,
				"LUT changed during render"
			);
		artifacts.set(name, result.rgba);
		samples.push({
			name,
			adjustments,
			packagePath: resolution?.packagePath ?? null,
			source: resolution?.source ?? "none",
			lutSha256: lutBefore,
			rgbaSha256: sha256({ bytes: result.rgba }),
			...metrics,
		});
		console.log(JSON.stringify(samples.at(-1)));
	};
	try {
		await save({ name: "original.png", rgba: original });
		await render({ name: "legacy-pink" });
		await JIANYING_PORTRAIT_SKIN_TONES.reduce(async (previous, tone) => {
			await previous;
			await render({
				name: tone.resourceId,
				skinToneResourceId: tone.resourceId,
			});
		}, Promise.resolve());
		const legacyPink = artifacts.get("legacy-pink");
		assert(legacyPink);
		assert.deepEqual(
			artifacts.get("7408757645705760000"),
			legacyPink,
			"Explicit pink changed the pinned legacy result"
		);
		assert.equal(
			new Set(samples.slice(1).map((sample) => sample.rgbaSha256)).size,
			5,
			"Five distinct LUTs must yield five distinct results on this fixture"
		);
		await JIANYING_PORTRAIT_SKIN_TONES.reduce(async (previous, tone) => {
			await previous;
			const pixels = artifacts.get(tone.resourceId);
			assert(pixels);
			await save({
				name: `${tone.resourceId}-vs-legacy-pink-x8.png`,
				rgba: diff({ actual: pixels, expected: legacyPink }),
			});
		}, Promise.resolve());
		await render({
			name: "none-stale-warmth",
			skinToneResourceId: null,
			warmth: 25,
		});
		await render({
			name: "zero-selected",
			skinToneResourceId: "7408757645705776384",
			intensity: 0,
		});
		await render({
			name: "warmth-only",
			skinToneResourceId: "7408757645705776384",
			intensity: 0,
			warmth: 25,
		});
		assert.equal(
			sha256({ bytes: await readFile(source) }),
			report.sourceSha256,
			"Source changed during capture"
		);
		report.passed = true;
	} catch (error) {
		report.error = String(error);
		throw error;
	} finally {
		await provider.clear();
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(report, null, 2)
		);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
