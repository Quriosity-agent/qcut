import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { prepareIndependentPortraitExport } from "../export-independent-portrait";

function clip({
	name,
	portraitAdjustments,
	children = [],
}: {
	name: string;
	portraitAdjustments?: MediaElement["portraitAdjustments"];
	children?: MediaElement[];
}): MediaElement {
	return {
		id: name,
		name,
		type: "media",
		mediaId: `${name}-media`,
		startTime: 0,
		duration: 1,
		trimStart: 0,
		trimEnd: 0,
		...(portraitAdjustments ? { portraitAdjustments } : {}),
		...(children.length > 0
			? {
					compound: {
						kind: "compound" as const,
						clips: children.map((element, layer) => ({
							id: element.id,
							offset: 0,
							layer,
							sourceTrackId: "child-track",
							element,
						})),
					},
				}
			: {}),
	} as MediaElement;
}

const tracks = ({ elements }: { elements: MediaElement[] }) =>
	[{ id: "track", type: "media", elements }] as unknown as TimelineTrack[];

const independent = {
	enabled: true,
	engine: "independent" as const,
	values: { face_adjust_Whiten: 45 },
};

let inspectIndependent: ReturnType<typeof vi.fn>;
beforeEach(() => {
	inspectIndependent = vi.fn(async () => ({
		available: true,
		provider: "qcut-independent-photo-v1",
		message: "ready",
		controls: ["face_adjust_Whiten"],
		makeupCards: [],
	}));
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { beautyLab: { inspectIndependent } },
	});
});
afterEach(() => {
	Reflect.deleteProperty(window, "electronAPI");
});

describe("independent portrait export preflight", () => {
	it("skips the engine check when no clip uses it", async () => {
		await expect(
			prepareIndependentPortraitExport({
				tracks: tracks({
					elements: [
						clip({
							name: "native",
							portraitAdjustments: { ...independent, engine: "native" },
						}),
						clip({
							name: "neutral",
							portraitAdjustments: { ...independent, values: {} },
						}),
					],
				}),
			})
		).resolves.toEqual({ clips: 0 });
		expect(inspectIndependent).not.toHaveBeenCalled();
	});

	it("counts independent clips, including compound children", async () => {
		await expect(
			prepareIndependentPortraitExport({
				tracks: tracks({
					elements: [
						clip({ name: "top", portraitAdjustments: independent }),
						clip({
							name: "compound",
							children: [
								clip({ name: "child", portraitAdjustments: independent }),
							],
						}),
					],
				}),
			})
		).resolves.toEqual({ clips: 2 });
		expect(inspectIndependent).toHaveBeenCalledOnce();
	});

	it("stops before rendering when the engine is unavailable", async () => {
		inspectIndependent.mockResolvedValueOnce({
			available: false,
			provider: "qcut-independent-photo-v1",
			message: "runtime missing",
			controls: [],
			makeupCards: [],
		});
		await expect(
			prepareIndependentPortraitExport({
				tracks: tracks({
					elements: [clip({ name: "top", portraitAdjustments: independent })],
				}),
			})
		).rejects.toThrow("自研美颜引擎不可用：runtime missing");
	});

	it("names the clip whose edits the engine cannot run", async () => {
		await expect(
			prepareIndependentPortraitExport({
				tracks: tracks({
					elements: [
						clip({
							name: "采访",
							portraitAdjustments: {
								...independent,
								values: { face_adjust_BrightEye: 20 },
							},
						}),
					],
				}),
			})
		).rejects.toThrow(
			"片段「采访」自研美颜不支持这些参数：face_adjust_BrightEye"
		);
	});
});
