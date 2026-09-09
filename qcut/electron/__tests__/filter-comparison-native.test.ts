// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createFogComparison } from "../qcut-independent-filter/comparison.js";
import {
	QCUT_FOG_RESOURCE,
	QCUT_FOG_VERSION,
} from "../qcut-independent-filter/contract.js";

describe.skipIf(
	process.platform !== "darwin" ||
		process.env.QCUT_FOG_COMPARISON_NATIVE !== "1"
)("real Fog comparison adapter with the verified local LUT", () => {
	it("returns actual decoded stages, deterministic results, and exact zero strength", async () => {
		const width = 33;
		const height = 19;
		const rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
			i % 4 === 3 ? 255 : (i * 37 + 19) % 256
		);
		const compare = createFogComparison();
		const request = {
			resourceId: QCUT_FOG_RESOURCE,
			version: QCUT_FOG_VERSION,
			width,
			height,
			rgba,
			intensity: 0,
		};
		const zero = await compare({ request });
		expect(zero.metrics).toMatchObject({
			rgbMax: 0,
			alphaMax: 0,
			changedPixels: 0,
		});
		expect(zero.input.sha256).toBe(zero.reference.sha256);
		const full = await compare({ request: { ...request, intensity: 100 } });
		const repeat = await compare({ request: { ...request, intensity: 100 } });
		expect(repeat.metrics).toEqual(full.metrics);
		expect(repeat.candidate.sha256).toBe(full.candidate.sha256);
		expect(repeat.reference.sha256).toBe(full.reference.sha256);
		expect(full.reference.sha256).not.toBe(full.input.sha256);
		expect(full.referenceStages.map(({ name }) => name)).toEqual([
			"00-input",
			"01-blur-x",
			"02-blur-y",
			"03-fog",
			"04-lut",
		]);
		expect(full.referenceStages[4].sha256).toBe(full.reference.sha256);
		expect(full.metrics.rgbMax).toBeLessThanOrEqual(2);
		expect(full.metrics.alphaMax).toBe(0);
		const decoded = await loadImage(
			Buffer.from(
				zero.input.png.slice("data:image/png;base64,".length),
				"base64"
			)
		);
		const canvas = createCanvas(width, height);
		canvas.getContext("2d").drawImage(decoded, 0, 0);
		expect(
			new Uint8Array(
				canvas.getContext("2d").getImageData(0, 0, width, height).data
			)
		).toEqual(rgba);
	}, 180_000);
});
