import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { timelineApplyManifest } from "../native-pipeline/editor/editor-timeline-apply.js";
import {
	describeManifestProblems,
	manifestProblems,
} from "../native-pipeline/editor/editor-timeline-apply-preflight.js";

const clip = {
	type: "media",
	mediaId: "media-1",
	startTime: 0,
	duration: 2,
};

function untouchedEditor() {
	const refuse = (method: string) =>
		vi.fn(async (url: string) => {
			throw new Error(`The editor was asked for ${method} ${url}`);
		});
	const client = {
		get: refuse("GET"),
		post: refuse("POST"),
		patch: refuse("PATCH"),
		delete: refuse("DELETE"),
	};
	return { client: client as unknown as EditorApiClient, calls: client };
}

function options(manifest: object): CLIRunOptions {
	return {
		command: "editor:timeline:apply",
		projectId: "project-1",
		manifest: JSON.stringify(manifest),
		atomic: true,
		verify: true,
		replace: true,
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
	} as CLIRunOptions;
}

describe("what a manifest shows to be wrong before it is applied", () => {
	it("finds nothing in a manifest the editor would take", () => {
		expect(
			manifestProblems({
				manifest: {
					tracks: [
						{
							name: "Main",
							type: "media",
							colorLabel: "violet",
							elements: [
								{
									...clip,
									blendMode: "overlay",
									blendEnabled: true,
									opacity: 0.8,
									fitMode: "contain",
									color: {
										lut: {
											enabled: true,
											cube: { size: 2, values: new Array(24).fill(0.5) },
										},
									},
								},
							],
						},
						{ name: "No colour", type: "audio", colorLabel: null },
						{
							name: "Titles",
							type: "text",
							elements: [
								{
									type: "text",
									startTime: 0,
									duration: 2,
									content: "Hello",
									color: "#ffcc00",
									x: "center",
								},
							],
							transitions: [],
						},
					],
				},
			})
		).toEqual([]);
	});

	/** 问题 8 (2026-11-14): `colorLabel: "cyan"` failed the apply 3 s in. */
	it("names a track colour the editor does not have", () => {
		expect(
			manifestProblems({
				manifest: {
					tracks: [
						{
							name: "调色 · 暗角",
							alias: "vignette",
							type: "media",
							colorLabel: "cyan",
						},
					],
				},
			})
		).toEqual([
			`Track 'vignette': colorLabel must be one of: violet, blue, green, yellow, red, rose, orange, mango (got "cyan")`,
		]);
	});

	it("reports every problem at once, each with the name the apply uses", () => {
		const problems = manifestProblems({
			manifest: {
				elements: [{ ...clip, alias: "loose", blendMode: "soft-light" }],
				tracks: [
					{ name: "A", type: "video" },
					{
						name: "B",
						type: "media",
						elements: [
							{ ...clip, colorLabel: "teal" },
							{ type: "media", mediaId: "media-1", startTime: -1 },
							{ ...clip, alias: "graded", opacity: "half", fitMode: "stretch" },
							{
								...clip,
								color: {
									lut: { cube: { size: 3, values: new Array(24).fill(0) } },
								},
							},
							{ mediaId: "media-1", duration: 2 },
						],
					},
					{ name: "C" },
				],
			},
		});
		expect(problems).toEqual([
			`Track 'track-0': type must be one of media, effect, text, audio, sticker, captions, adjustment, remotion, hyperframes, markdown (got "video")`,
			"Track 'track-2' is missing type",
			"Element 'loose': blendMode must be one of normal, multiply, screen, overlay, darken, lighten",
			`Element 'element-1': colorLabel must be one of: violet, blue, green, yellow, red, rose, orange, mango (got "teal")`,
			"Element 'element-2': startTime must be 0 or more",
			"Element 'graded': fitMode must be one of cover, contain, fill",
			"Element 'graded': opacity must be a finite number",
			"Element 'element-4': color.lut.cube.values must hold 81 numbers (size³ × 3 for size 3); it holds 24",
			"Element 'element-5' is missing type",
			"Element 'element-5' is missing startTime",
		]);
	});

	it("checks transitions once the tracks themselves are sound", () => {
		expect(
			manifestProblems({
				manifest: {
					tracks: [
						{
							name: "Main",
							type: "media",
							elements: [clip],
							transitions: [{ from: "a", to: "b", type: "fade" }],
						},
					],
				},
			})
		).toEqual(["Transition 0 needs type and duration"]);
	});

	it("keeps a long list readable", () => {
		const problems = Array.from({ length: 23 }, (_, index) => `p${index}`);
		const message = describeManifestProblems({ problems });
		expect(message).toMatch(
			/^The manifest has 23 problems; nothing was changed\. p0; p1; /
		);
		expect(message).toMatch(/p19; and 3 more$/);
	});
});

describe("timeline apply with a manifest that cannot be applied", () => {
	it("fails before the editor is asked for anything", async () => {
		const { client, calls } = untouchedEditor();
		const result = await timelineApplyManifest(
			client,
			options({
				tracks: [
					{ name: "Main", type: "media", elements: [clip] },
					{ name: "调色 · 暗角", type: "media", colorLabel: "cyan" },
				],
			})
		);
		expect(result.success).toBe(false);
		expect(result.error).toBe(
			`The manifest has 1 problem; nothing was changed. Track 'track-1': colorLabel must be one of: violet, blue, green, yellow, red, rose, orange, mango (got "cyan")`
		);
		expect(result.data).toEqual({
			projectId: "project-1",
			changed: false,
			rolledBack: false,
			problems: [
				`Track 'track-1': colorLabel must be one of: violet, blue, green, yellow, red, rose, orange, mango (got "cyan")`,
			],
		});
		for (const method of Object.values(calls)) {
			expect(method).not.toHaveBeenCalled();
		}
	});
});
