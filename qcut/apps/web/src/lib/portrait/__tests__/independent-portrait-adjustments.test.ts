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
				selections: ["faces", "manual-retouch"],
			},
		});
		if ("issue" in result)
			expect(independentPortraitIssueMessage({ issue: result.issue })).toBe(
				"自研美颜只能对全部人脸统一处理，请先清除：单人或分人物设置、手动精修"
			);
	});

	it("passes an active stretch band to an engine that renders it", () => {
		const stretch = { intensity: -30, upper: 0.72, bottom: 0.18 };
		expect(
			independentPortraitRequest({
				adjustments: { ...base, manualBody: { stretch } },
				support: { ...support, manualBodyTools: ["stretch"] },
			})
		).toEqual({
			adjustments: {
				enabled: true,
				values: { face_adjust_Whiten: 45 },
				makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
				manualBody: { stretch },
			},
		});
		// Without the engine's support list the engine itself validates it.
		expect(
			independentPortraitRequest({
				adjustments: { ...base, manualBody: { stretch } },
			})
		).toMatchObject({ adjustments: { manualBody: { stretch } } });
	});

	it("passes active slim and zoom to an engine that renders them, idle tools dropped", () => {
		const slim = {
			intensity: 20,
			x: 0.5,
			y: 0.45,
			width: 0.3,
			height: 0.3,
			rotation: 30,
		};
		const zoom = { intensity: -10, x: 0.5, y: 0.6, radius: 0.2 };
		const adjustments = {
			...base,
			manualBody: {
				stretch: { intensity: 0, upper: 0.448, bottom: 0.202 },
				slim,
				zoom,
			},
		};
		expect(
			independentPortraitRequest({
				adjustments,
				support: { ...support, manualBodyTools: ["stretch", "slim", "zoom"] },
			})
		).toMatchObject({ adjustments: { manualBody: { slim, zoom } } });
		const unchecked = independentPortraitRequest({ adjustments });
		expect(
			"adjustments" in unchecked ? unchecked.adjustments.manualBody : undefined
		).toEqual({ slim, zoom });
	});

	it("reports manual body tools the engine does not render", () => {
		const stretch = { intensity: 20, upper: 0.7, bottom: 0.2 };
		const older = independentPortraitRequest({
			adjustments: { ...base, manualBody: { stretch } },
			support,
		});
		expect(older).toEqual({
			issue: { code: "unsupported", selections: ["manualBody.stretch"] },
		});
		const result = independentPortraitRequest({
			adjustments: {
				...base,
				manualBody: {
					stretch,
					slim: {
						intensity: 20,
						x: 0.5,
						y: 0.5,
						width: 0.3,
						height: 0.3,
						rotation: 0,
					},
					zoom: { intensity: -10, x: 0.5, y: 0.5, radius: 0.2 },
				},
			},
			support: { ...support, manualBodyTools: ["stretch"] },
		});
		expect(result).toEqual({
			issue: {
				code: "unsupported",
				selections: ["manualBody.slim", "manualBody.zoom"],
			},
		});
		if ("issue" in result)
			expect(independentPortraitIssueMessage({ issue: result.issue })).toBe(
				"自研美颜不支持这些参数：手动美体·瘦身、手动美体·放大缩小"
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

	it("allows a selected skin tone while both strengths are neutral", () => {
		expect(
			independentPortraitRequest({
				adjustments: {
					...base,
					skinToneResourceId: "7408757645705743616",
					values: {
						...base.values,
						face_adjust_skin_Intensity: 0,
						face_adjust_skin_ColdWarm: 0,
					},
				},
				support,
			})
		).toEqual(independentPortraitRequest({ adjustments: base, support }));
	});

	it("refuses an active skin tone resource instead of silently dropping it", () => {
		expect(
			independentPortraitRequest({
				adjustments: {
					...base,
					skinToneResourceId: "7408757645705743616",
					values: { ...base.values, face_adjust_skin_Intensity: 20 },
				},
				support,
			})
		).toEqual({ issue: { code: "scope", selections: ["skin-tone"] } });
	});
});
