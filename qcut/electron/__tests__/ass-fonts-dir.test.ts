import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	assFamiliesFromScript,
	platformAssFontsDirectory,
	prepareAssFontsDirectory,
} from "../claude/handlers/claude-export-handler/ass-fonts-dir.js";
import { getFFmpegPath } from "../ffmpeg/paths";

/**
 * N9 (2026-10-28 trailer report): `bold: true` captions in Avenir Next came
 * out Bold Italic. libass only looked in /System/Library/Fonts/Supplemental;
 * Avenir Next lives in /System/Library/Fonts, so the CoreText provider chose
 * the face, and it chose AvenirNext-BoldItalic.
 */

vi.mock("electron", () => ({
	app: { getPath: () => tmpdir(), isPackaged: false },
}));

const AVENIR = "/System/Library/Fonts/Avenir Next.ttc";
const onMacWithAvenir = process.platform === "darwin" && existsSync(AVENIR);

function script({ family, bold }: { family: string; bold: boolean }): string {
	return [
		"[Script Info]",
		"ScriptType: v4.00+",
		"PlayResX: 640",
		"PlayResY: 360",
		"",
		"[V4+ Styles]",
		"Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
		`Style: Caption,${family},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,${bold ? -1 : 0},0,0,0,100,100,0,0,1,0,0,5,10,10,10,1`,
		"",
		"[Events]",
		"Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
		"Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,{\\fnFutura}Round {\\fnSongti SC\\b1}one",
		"",
	].join("\n");
}

describe("ASS fonts folder", () => {
	const made: string[] = [];
	afterEach(() => {
		for (const directory of made.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("reads every family a script names, styles and overrides alike", () => {
		expect(
			assFamiliesFromScript(script({ family: "Avenir Next", bold: true }))
		).toEqual(["Avenir Next", "Futura", "Songti SC"]);
	});

	it("keeps the platform folder off macOS", () => {
		const directory = path.join(tmpdir(), "never-made");
		expect(
			prepareAssFontsDirectory({
				scripts: [script({ family: "Arial", bold: false })],
				directory,
				platform: "linux",
			})
		).toBeUndefined();
		expect(
			prepareAssFontsDirectory({
				scripts: [script({ family: "Arial", bold: false })],
				directory,
				platform: "win32",
			})
		).toBe(platformAssFontsDirectory("win32"));
		expect(existsSync(directory)).toBe(false);
	});

	it("falls back to the platform folder when no family is installed", () => {
		const fonts = mkdtempSync(path.join(tmpdir(), "qcut-no-fonts-"));
		made.push(fonts);
		expect(
			prepareAssFontsDirectory({
				scripts: [script({ family: "No Such Font", bold: false })],
				directory: path.join(fonts, "out"),
				fontDirectories: [fonts],
				platform: "darwin",
			})
		).toBe("/System/Library/Fonts/Supplemental");
	});

	it.skipIf(!onMacWithAvenir)(
		"links the files of the families used, from /System/Library/Fonts too",
		() => {
			const work = mkdtempSync(path.join(tmpdir(), "qcut-ass-fonts-"));
			made.push(work);
			const directory = prepareAssFontsDirectory({
				scripts: [script({ family: "Avenir Next", bold: true })],
				directory: path.join(work, "fonts"),
			});
			expect(directory).toBe(path.join(work, "fonts"));
			const linked = readdirSync(directory as string).map((name) =>
				realpathSync(path.join(directory as string, name))
			);
			expect(linked).toContain(AVENIR);
			// Only the families named, not whole system folders.
			expect(linked.length).toBeLessThan(12);
		}
	);

	it.skipIf(!onMacWithAvenir)(
		"bold Avenir Next renders upright through the bundled FFmpeg",
		() => {
			const work = mkdtempSync(path.join(tmpdir(), "qcut-ass-bold-"));
			made.push(work);
			const assPath = path.join(work, "bold.ass");
			const content = script({ family: "Avenir Next", bold: true }).replace(
				/\{\\fnFutura\}Round \{\\fnSongti SC\\b1\}one/,
				"IIII"
			);
			writeFileSync(assPath, content);
			const directory = prepareAssFontsDirectory({
				scripts: [content],
				directory: path.join(work, "fonts"),
			});
			const result = spawnSync(
				getFFmpegPath(),
				[
					"-hide_banner",
					"-loglevel",
					"debug",
					"-f",
					"lavfi",
					"-i",
					"color=black:s=640x360:d=0.1",
					"-vf",
					`ass=${assPath}:fontsdir=${directory}`,
					"-frames:v",
					"1",
					"-y",
					path.join(work, "frame.png"),
				],
				{ encoding: "utf8", timeout: 30_000 }
			);
			const selection = result.stderr
				.split("\n")
				.find((line) => line.includes("fontselect: (Avenir Next, 700, 0)"));
			expect(selection).toContain("AvenirNext-Bold");
			expect(selection).not.toContain("Italic");
		}
	);
});
