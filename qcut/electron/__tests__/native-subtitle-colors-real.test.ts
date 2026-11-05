import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { escapeFfmpegFilterPath } from "../ffmpeg/color-lut-file.js";
import { getFFmpegPath } from "../ffmpeg/paths.js";
import {
	generateASS,
	resolveSubtitleStyle,
} from "../native-pipeline/subtitle/subtitle-types.js";

const ffmpeg = process.env.QCUT_TEST_FFMPEG ?? getFFmpegPath();
const directory = mkdtempSync(
	path.join(tmpdir(), "qcut-native-subtitle-colors-")
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const width = 320;
const height = 180;
let nextId = 0;

function render({
	backgroundColor,
	bgOpacity,
}: {
	backgroundColor: string;
	bgOpacity: number;
}): Buffer {
	const script = generateASS(
		[
			{
				id: "caption",
				name: "Caption",
				type: "captions",
				text: "Hello",
				language: "en",
				source: "manual",
				startTime: 0,
				duration: 1,
				trimStart: 0,
				trimEnd: 0,
				style: resolveSubtitleStyle({
					fontColor: "white",
					outlineColor: "lime",
					outlineWidth: 3,
					shadowOffset: { x: 0, y: 0 },
					backgroundColor,
					bgOpacity,
					position: { align: "bottom", x: 50, y: 30 },
				}),
			},
		],
		{ resolution: { width, height } }
	);
	const file = path.join(directory, `caption-${nextId++}.ass`);
	writeFileSync(file, script);
	const result = spawnSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=black:s=${width}x${height}:d=1`,
			"-vf",
			`ass='${escapeFfmpegFilterPath(file)}'`,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: width * height * 4, timeout: 20_000 }
	);
	expect(result.status, result.stderr.toString()).toBe(0);
	expect(result.stdout.length).toBe(width * height * 3);
	return result.stdout;
}

function pixels({ frame }: { frame: Buffer }) {
	let blue = 0;
	let halfBlue = 0;
	let green = 0;
	let white = 0;
	for (let at = 0; at < frame.length; at += 3) {
		const r = frame[at];
		const g = frame[at + 1];
		const b = frame[at + 2];
		if (b > r + 20 && b > g + 20) blue++;
		if (r <= 3 && g <= 3 && b >= 123 && b <= 130) halfBlue++;
		if (g > r + 20 && g > b + 20) green++;
		if (r > 220 && g > 220 && b > 220) white++;
	}
	return { blue, halfBlue, green, white };
}

describe("native subtitle colors through real libass", () => {
	it("renders the background's own alpha without replacing the glyph outline", () => {
		const measured = pixels({
			frame: render({
				backgroundColor: "rgba(0, 0, 255, 0.5)",
				bgOpacity: 0.2,
			}),
		});
		expect(measured.blue).toBeGreaterThan(500);
		expect(measured.halfBlue).toBeGreaterThan(200);
		expect(measured.green).toBeGreaterThan(200);
		expect(measured.white).toBeGreaterThan(200);
	});

	it.each([
		{ backgroundColor: "transparent", bgOpacity: 0.8 },
		{ backgroundColor: "rgba(0, 0, 255, 0.5)", bgOpacity: 0 },
	])("draws no background for $backgroundColor with opacity $bgOpacity", (style) => {
		const measured = pixels({ frame: render(style) });
		expect(measured.blue).toBe(0);
		expect(measured.green).toBeGreaterThan(200);
		expect(measured.white).toBeGreaterThan(200);
	});
});
