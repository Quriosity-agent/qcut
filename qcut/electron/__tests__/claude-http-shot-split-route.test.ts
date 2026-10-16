import { describe, expect, it } from "vitest";
import { readShotSplitRequest } from "../claude/http/claude-http-shared-routes.js";

/** The shot-split body is checked field by field; refusals name the field. */
describe("readShotSplitRequest", () => {
	it("takes one target with the optional plan fields", () => {
		expect(
			readShotSplitRequest({
				projectId: "p",
				body: {
					elementId: " e1 ",
					engine: "auto",
					cuts: [1, 2],
					minShotSeconds: 0.5,
					dryRun: true,
				},
			})
		).toEqual({
			projectId: "p",
			elementId: "e1",
			trackId: undefined,
			engine: "auto",
			cuts: [1, 2],
			minShotSeconds: 0.5,
			dryRun: true,
		});
		expect(
			readShotSplitRequest({ projectId: "p", body: { trackId: "t1" } })
		).toMatchObject({
			trackId: "t1",
		});
	});

	it("refuses two targets, none, bad engines and bad numbers", () => {
		const refusal = (body: unknown) => {
			try {
				readShotSplitRequest({ projectId: "p", body });
			} catch (error) {
				return (error as { status?: number; message: string }).status;
			}
			return undefined;
		};
		expect(refusal({})).toBe(400);
		expect(refusal({ elementId: "e", trackId: "t" })).toBe(400);
		expect(refusal({ elementId: "e", engine: "magic" })).toBe(400);
		expect(refusal({ elementId: "e", cuts: ["1"] })).toBe(400);
		expect(refusal({ elementId: "e", minShotSeconds: -1 })).toBe(400);
		expect(refusal({ elementId: "e", dryRun: "yes" })).toBe(400);
	});

	it("takes a threshold only for FFmpeg or auto detection", () => {
		const status = (body: unknown) => {
			try {
				readShotSplitRequest({ projectId: "p", body });
			} catch (error) {
				return (error as { status?: number; message: string }).message;
			}
			return "accepted";
		};
		expect(status({ elementId: "e", threshold: 0.3 })).toBe("accepted");
		expect(status({ elementId: "e", engine: "auto", threshold: 0.3 })).toBe(
			"accepted"
		);
		expect(status({ elementId: "e", engine: "ffmpeg", threshold: 0.3 })).toBe(
			"accepted"
		);
		for (const body of [
			{ elementId: "e", engine: "jianying", threshold: 0.3 },
			{ elementId: "e", engine: "onnx", threshold: 0.3 },
			{ elementId: "e", cuts: [1], threshold: 0.3 },
			// A dry run plans with the same engine, so the same rule applies.
			{ elementId: "e", engine: "jianying", threshold: 0.2, dryRun: true },
			{ elementId: "e", cuts: [3.333], threshold: 0.2, dryRun: true },
		]) {
			expect(status(body)).toBe(
				"threshold is only supported by the FFmpeg scene engine"
			);
		}
	});
});
