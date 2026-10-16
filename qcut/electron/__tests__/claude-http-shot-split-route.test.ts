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
});
