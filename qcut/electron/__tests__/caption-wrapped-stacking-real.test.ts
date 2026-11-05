import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { assFontFamilyInstalled } from "../claude/handlers/claude-export-handler/ass-font-metrics.js";
import {
	buildTextAss,
	collectTextOverlays,
} from "../claude/handlers/claude-export-handler/text-overlay.js";
import { escapeFfmpegFilterPath } from "../ffmpeg/color-lut-file.js";
import type { ClaudeTimeline } from "../types/claude-api.js";

const width = 480;
const height = 720;
const ffmpeg =
	process.env.QCUT_TEST_FFMPEG ??
	path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		`../resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg${process.platform === "win32" ? ".exe" : ""}`
	);
const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), "qcut-caption-wrap-stack-")
);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

function scriptFor({ align }: { align: "top" | "bottom" }): string {
	const timeline: ClaudeTimeline = {
		name: "Measured caption stack",
		duration: 3.2,
		width,
		height,
		fps: 30,
		tracks: [0, 1].map((index) => ({
			id: `track-${index}`,
			index,
			name: "Captions",
			type: "captions",
			elements: [
				{
					id: `caption-${index}`,
					trackIndex: index,
					type: "captions",
					startTime: index === 0 ? 0 : 0.2,
					endTime: index === 0 ? 2 : 3.2,
					duration: index === 0 ? 2 : 3,
					content:
						index === 0
							? "A long primary caption wraps across several lines without explicit breaks, and its whole box must stay separate."
							: "Later caption",
					secondaryContent:
						index === 0
							? "The secondary language also wraps using its own smaller font size."
							: undefined,
					style: {
						fontFamily: "Arial",
						fontSize: 32,
						fontColor: "white",
						fontOpacity: 1,
						lineSpacing: 1.2,
						backgroundColor: index === 0 ? "#e00000" : "#0000e0",
						bgOpacity: 1,
						outlineWidth: 0,
						shadowOffset: { x: 0, y: 0 },
						position: { align, x: 50, y: 90 },
						secondary: {
							fontFamily: "Arial",
							fontSize: 20,
							fontColor: "white",
						},
					},
				},
			],
		})),
	};
	return buildTextAss({
		overlays: collectTextOverlays(timeline),
		width,
		height,
	});
}

function render({ file, time }: { file: string; time: number }): Buffer {
	const result = spawnSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=black:s=${width}x${height}:d=3.3:r=30`,
			"-vf",
			`ass='${escapeFfmpegFilterPath(file)}'`,
			"-ss",
			String(time),
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

function colorBounds({ frame, channel }: { frame: Buffer; channel: 0 | 2 }) {
	let top = height;
	let bottom = -1;
	let count = 0;
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		const at = pixel * 3;
		if (
			frame[at + channel] < 100 ||
			frame[at + channel] < frame[at + 1] + 80 ||
			frame[at + channel] < frame[at + 2 - channel] + 80
		)
			continue;
		const row = Math.floor(pixel / width);
		top = Math.min(top, row);
		bottom = Math.max(bottom, row);
		count += 1;
	}
	return { top, bottom, count };
}

function saveEvidence({
	align,
	script,
	frame,
	later,
	metrics,
}: {
	align: string;
	script: string;
	frame: Buffer;
	later: Buffer;
	metrics: object;
}) {
	const destination = process.env.QCUT_CAPTION_STACK_ARTIFACT_DIR;
	if (!destination) return;
	fs.mkdirSync(destination, { recursive: true });
	fs.writeFileSync(path.join(destination, `${align}.ass`), script);
	fs.writeFileSync(
		path.join(destination, `${align}.json`),
		JSON.stringify(metrics, null, 2)
	);
	for (const [suffix, data] of [
		["overlap", frame],
		["after-expiry", later],
	] as const) {
		const result = spawnSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-y",
				"-f",
				"rawvideo",
				"-pixel_format",
				"rgb24",
				"-video_size",
				`${width}x${height}`,
				"-i",
				"pipe:0",
				"-frames:v",
				"1",
				path.join(destination, `${align}-${suffix}.png`),
			],
			{ input: data, timeout: 20_000 }
		);
		expect(result.status, result.stderr.toString()).toBe(0);
	}
}

describe.skipIf(
	!fs.existsSync(ffmpeg) || !assFontFamilyInstalled({ family: "Arial" })
)("native measured caption stacks through real libass", () => {
	it.each([
		"top",
		"bottom",
	] as const)("reserves every wrapped primary and secondary row at the %s edge", (align) => {
		const script = scriptFor({ align });
		const file = path.join(directory, `${align}.ass`);
		fs.writeFileSync(file, script);
		const frame = render({ file, time: 0.75 });
		const later = render({ file, time: 2.25 });
		const first = colorBounds({ frame, channel: 0 });
		const second = colorBounds({ frame, channel: 2 });
		const secondAfterExpiry = colorBounds({ frame: later, channel: 2 });
		const overlapRows = Math.max(
			0,
			Math.min(first.bottom, second.bottom) -
				Math.max(first.top, second.top) +
				1
		);
		saveEvidence({
			align,
			script,
			frame,
			later,
			metrics: { first, second, secondAfterExpiry, overlapRows },
		});
		expect(first.count).toBeGreaterThan(1000);
		expect(second.count).toBeGreaterThan(500);
		expect(first.bottom - first.top).toBeGreaterThan(150);
		expect(overlapRows).toBeLessThanOrEqual(1);
		expect(Math.abs(secondAfterExpiry.top - second.top)).toBeLessThanOrEqual(1);
		expect(
			Math.abs(secondAfterExpiry.bottom - second.bottom)
		).toBeLessThanOrEqual(1);
		expect(colorBounds({ frame: later, channel: 0 }).count).toBe(0);
	});
});
