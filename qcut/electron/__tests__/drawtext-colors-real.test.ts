import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TextElement } from "../../apps/web/src/types/timeline";
import { convertTextElementToDrawtext } from "../../apps/web/src/lib/export-cli/filters/text-overlay";
import { getFFmpegPath } from "../ffmpeg/paths";
import { escapeFfmpegFilterPath } from "../ffmpeg/color-lut-file";
import { buildDrawtextFilters } from "../native-pipeline/subtitle/subtitle-drawtext";
import {
	resolveSubtitleStyle,
	type CaptionElement,
	type SubtitleStyle,
} from "../native-pipeline/subtitle/subtitle-types";

const ffmpeg = getFFmpegPath();
const caption: CaptionElement = {
	id: "caption",
	name: "Caption",
	type: "captions",
	text: "MM",
	language: "en",
	source: "manual",
	startTime: 0,
	duration: 1,
	trimStart: 0,
	trimEnd: 0,
};

function channelPeaks({ filter }: { filter: string }): number[] {
	// Pin the colour fixture's font without requiring Windows fontconfig setup.
	const renderedFilter =
		process.platform === "win32"
			? filter.replace(
					/:font=(?:'[^']*'|[^:]+)/,
					`:fontfile='${escapeFfmpegFilterPath(path.join(process.env.WINDIR ?? "C:/Windows", "Fonts", "arial.ttf"))}'`
				)
			: filter;
	const result = spawnSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=black:s=240x180:r=1:d=1,format=rgb24",
			"-vf",
			renderedFilter,
			"-frames:v",
			"1",
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"-",
		],
		{ maxBuffer: 240 * 180 * 4, timeout: 20_000 }
	);
	expect(result.status, result.stderr.toString()).toBe(0);
	expect(result.stdout.length).toBe(240 * 180 * 3);
	const peaks = [0, 0, 0];
	for (let index = 0; index < result.stdout.length; index++) {
		peaks[index % 3] = Math.max(peaks[index % 3], result.stdout[index]);
	}
	return peaks;
}

function expectPeaks({
	actual,
	expected,
}: {
	actual: number[];
	expected: number[];
}) {
	for (let channel = 0; channel < 3; channel++) {
		expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(
			2
		);
	}
}

function nativeFilter({ overrides }: { overrides: Partial<SubtitleStyle> }) {
	return buildDrawtextFilters({
		clips: [caption],
		style: resolveSubtitleStyle({
			fontSize: 72,
			fontColor: "transparent",
			outlineWidth: 0,
			shadowOffset: { x: 0, y: 0 },
			bgOpacity: 0,
			position: { align: "center", x: 0, y: 0 },
			...overrides,
		}),
	});
}

function textFilter({ overrides }: { overrides: Partial<TextElement> }) {
	return convertTextElementToDrawtext(
		{
			id: "text",
			name: "Text",
			type: "text",
			content: "MM",
			fontSize: 72,
			fontFamily: "sans-serif",
			color: "transparent",
			backgroundColor: "transparent",
			textAlign: "center",
			fontWeight: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			x: 0,
			y: 0,
			rotation: 0,
			opacity: 0.5,
			duration: 1,
			startTime: 0,
			trimStart: 0,
			trimEnd: 0,
			...overrides,
		},
		process.platform === "win32" || process.platform === "darwin"
			? process.platform
			: "linux"
	);
}

describe("native drawtext CSS colour output", () => {
	it.each([
		{
			name: "named colour with font opacity",
			overrides: { fontColor: "red", fontOpacity: 0.2 },
			expected: [51, 0, 0],
		},
		{
			name: "RGBA overrides font opacity",
			overrides: { fontColor: "rgba(255, 0, 0, 0.25)", fontOpacity: 0.8 },
			expected: [64, 0, 0],
		},
		{
			name: "HSL colour",
			overrides: { fontColor: "hsl(120, 100%, 50%)", fontOpacity: 0.2 },
			expected: [0, 51, 0],
		},
		{
			name: "eight-digit hex",
			overrides: { fontColor: "#0080ff80", fontOpacity: 0.8 },
			expected: [0, 64, 128],
		},
		{
			name: "font opacity zero",
			overrides: { fontColor: "rgba(255, 0, 0, 0.5)", fontOpacity: 0 },
			expected: [0, 0, 0],
		},
		{
			name: "CSS background alpha",
			overrides: { backgroundColor: "rgba(255, 0, 0, 0.25)", bgOpacity: 0.8 },
			expected: [64, 0, 0],
		},
		{
			name: "background opacity zero",
			overrides: { backgroundColor: "rgba(255, 0, 0, 0.25)", bgOpacity: 0 },
			expected: [0, 0, 0],
		},
		{
			name: "CSS outline alpha",
			overrides: { outlineColor: "rgba(0, 255, 0, 0.25)", outlineWidth: 4 },
			expected: [0, 64, 0],
		},
		{
			name: "CSS shadow alpha",
			overrides: {
				shadowColor: "hsla(240, 100%, 50%, 0.25)",
				shadowOffset: { x: 8, y: 8 },
			},
			expected: [0, 0, 64],
		},
	])("renders $name at the expected channel strength", ({
		overrides,
		expected,
	}) => {
		expectPeaks({
			actual: channelPeaks({ filter: nativeFilter({ overrides }) }),
			expected,
		});
	});
});

describe("editor drawtext CSS alpha with element opacity", () => {
	it("keeps fallback white at the requested background and element opacity", () => {
		expectPeaks({
			actual: channelPeaks({
				filter: textFilter({
					overrides: {
						backgroundColor: "not-a-colour",
						backgroundOpacity: 0.2,
					},
				}),
			}),
			expected: [26, 26, 26],
		});
	});

	it.each([
		{
			name: "stroke",
			overrides: {
				strokeColor: "rgba(255, 0, 0, 0.25)",
				strokeOpacity: 0.8,
				strokeWidth: 4,
			},
			expected: [32, 0, 0],
		},
		{
			name: "shadow",
			overrides: {
				shadowColor: "hsla(120, 100%, 50%, 0.25)",
				shadowOpacity: 0.8,
				shadowOffsetX: 8,
				shadowOffsetY: 8,
			},
			expected: [0, 32, 0],
		},
		{
			name: "background",
			overrides: { backgroundColor: "#0000ff40", backgroundOpacity: 0.8 },
			expected: [0, 0, 32],
		},
	])("preserves intrinsic $name alpha and multiplies element opacity", ({
		overrides,
		expected,
	}) => {
		expectPeaks({
			actual: channelPeaks({ filter: textFilter({ overrides }) }),
			expected,
		});
	});
});
