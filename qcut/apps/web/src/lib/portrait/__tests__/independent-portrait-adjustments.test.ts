import { describe, expect, it } from "vitest";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	independentPortraitIssueMessage,
	independentPortraitRequest,
} from "../independent-portrait-adjustments";

const support = {
	controls: ["face_adjust_Whiten", "face_adjust_Nose"],
	makeupCards: ["lip-coral-nude"],
};
const base: MediaPortraitAdjustments = {
	enabled: true,
	engine: "independent",
	values: { face_adjust_Whiten: 45, face_adjust_Nose: 0 },
	makeup: {
		lip: { cardId: "lip-coral-nude", intensity: 40 },
		brows: { cardId: "brows-flow", intensity: 0 },
	},
};

describe("independent portrait request", () => {
	it("keeps only active supported edits for the engine", () => {
		expect(independentPortraitRequest({ adjustments: base, support })).toEqual({
			adjustments: {
				enabled: true,
				values: { face_adjust_Whiten: 45 },
				makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
			},
		});
	});

	it("reports unsupported controls and cards instead of dropping them", () => {
		const result = independentPortraitRequest({
			adjustments: {
				...base,
				values: { face_adjust_Whiten: 45, face_adjust_BrightEye: 20 },
				makeup: { blush: { cardId: "blush-native-only", intensity: 30 } },
			},
			support,
		});
		expect(result).toEqual({
			issue: {
				code: "unsupported",
				selections: ["face_adjust_BrightEye", "blush-native-only"],
			},
		});
		if ("issue" in result)
			expect(independentPortraitIssueMessage({ issue: result.issue })).toBe(
				"自研美颜不支持这些参数：face_adjust_BrightEye、blush-native-only"
			);
	});

	it("leaves control validation to the engine when support is unknown", () => {
		expect(
			independentPortraitRequest({
				adjustments: { ...base, values: { face_adjust_BrightEye: 20 } },
			})
		).toMatchObject({ adjustments: { values: { face_adjust_BrightEye: 20 } } });
	});

	it("ignores skin-tone strength once the skin tone is switched off", () => {
		expect(
			independentPortraitRequest({
				adjustments: {
					...base,
					skinToneResourceId: null,
					values: { face_adjust_skin_Intensity: 60 },
					makeup: {},
				},
				support,
			})
		).toEqual({ adjustments: { enabled: true, values: {} } });
	});

	it("refuses per-person and manual edits the engine cannot target", () => {
		const result = independentPortraitRequest({
			adjustments: {
				...base,
				faces: [{ trackId: 1, values: { face_adjust_Whiten: 10 } }],
				manualRetouch: {
					strokes: [
						{
							id: "stroke",
							tool: "smooth",
							mode: "paint",
							size: 20,
							intensity: 50,
							points: [],
						},
					],
				},
				manualBody: {
					slim: {
						intensity: 20,
						x: 0.5,
						y: 0.5,
						width: 0.3,
						height: 0.3,
						rotation: 0,
					},
				},
			},
			support,
		});
		expect(result).toEqual({
			issue: {
				code: "scope",
				selections: ["faces", "manual-retouch", "manual-body"],
			},
		});
		if ("issue" in result)
			expect(independentPortraitIssueMessage({ issue: result.issue })).toBe(
				"自研美颜只能对全部人脸统一处理，请先清除：单人或分人物设置、手动精修、手动美体"
			);
	});

	it("treats neutral per-person and manual entries as no edit", () => {
		expect(
			independentPortraitRequest({
				adjustments: {
					...base,
					faces: [{ trackId: 1, values: { face_adjust_Whiten: 0 } }],
					manualRetouch: { strokes: [] },
					manualBody: {
						stretch: { intensity: 0, upper: 0.448, bottom: 0.202 },
					},
				},
				support,
			})
		).toMatchObject({ adjustments: { values: { face_adjust_Whiten: 45 } } });
	});

	it("refuses a single-face target", () => {
		expect(
			independentPortraitRequest({
				adjustments: { ...base, faceTarget: { mode: "single", faceId: 0 } },
				support,
			})
		).toEqual({ issue: { code: "scope", selections: ["faces"] } });
	});
});
