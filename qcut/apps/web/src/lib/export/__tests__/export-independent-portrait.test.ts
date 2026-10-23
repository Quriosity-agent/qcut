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
	it.each([
		{ bodyVideo: true },
		{
			bodyVideo: true,
			bodyVideoProfiles: {
				"swing-coreml-v1": { available: false, message: "models missing" },
			},
		},
		{
			bodyVideo: false,
			bodyVideoProfiles: {
				"swing-coreml-v1": { available: true, message: "models ready" },
			},
		},
	])("rejects an unavailable saved CoreML body profile before encoding: %j", async (profile) => {
		inspectIndependent.mockResolvedValueOnce({
			available: true,
			provider: "qcut-independent-photo-v1",
			message: "ready",
			controls: ["body_adjust_SlimBody"],
			makeupCards: [],
			...profile,
		});
		await expect(
			prepareIndependentPortraitExport({
				width: 1080,
				height: 1920,
				tracks: tracks({
					elements: [
						clip({
							name: "CoreML body",
							portraitAdjustments: {
								...independent,
								bodyVideoProfile: "swing-coreml-v1",
								values: { body_adjust_SlimBody: 40 },
							},
						}),
					],
				}),
			})
		).rejects.toThrow("片段「CoreML body」的 CoreML 视频美体不可用");
	});

	it("allows a saved CoreML preference when the edit only treats the face", async () => {
		await expect(
			prepareIndependentPortraitExport({
				width: 1080,
				height: 1920,
				tracks: tracks({
					elements: [
						clip({
							name: "Face only",
							portraitAdjustments: {
								...independent,
								bodyVideoProfile: "swing-coreml-v1",
							},
						}),
					],
				}),
			})
		).resolves.toEqual({ clips: 1 });
	});

	it.each([
		{ width: 0, height: 1080 },
		{ width: 1920, height: Number.NaN },
		{ width: 1920.5, height: 1080 },
	])("stops invalid dimensions before inspecting or rendering: %j", async (size) => {
		await expect(
			prepareIndependentPortraitExport({
				...size,
				tracks: tracks({
					elements: [
						clip({ name: "portrait", portraitAdjustments: independent }),
					],
				}),
			})
		).rejects.toThrow("有效的画面尺寸");
		expect(inspectIndependent).not.toHaveBeenCalled();
	});
	it.each([
		{ width: 1080, height: 1920 },
		{ width: 2160, height: 3840 },
		{ width: 7680, height: 4320 },
	])("accepts HD and bounded larger output canvases: %j", async (size) => {
		await expect(
			prepareIndependentPortraitExport({
				...size,
				tracks: tracks({
					elements: [
						clip({ name: "portrait", portraitAdjustments: independent }),
					],
				}),
			})
		).resolves.toEqual({ clips: 1 });
	});
	it("skips the engine check when no clip uses it", async () => {
		await expect(
			prepareIndependentPortraitExport({
				width: 1920,
				height: 1080,
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
				width: 1920,
				height: 1080,
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
				width: 1920,
				height: 1080,
				tracks: tracks({
					elements: [clip({ name: "top", portraitAdjustments: independent })],
				}),
			})
		).rejects.toThrow("自研美颜引擎不可用：runtime missing");
	});

	it("names the clip whose edits the engine cannot run", async () => {
		await expect(
			prepareIndependentPortraitExport({
				width: 1920,
				height: 1080,
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
