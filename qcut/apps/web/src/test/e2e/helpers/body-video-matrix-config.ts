import {
	DEFAULT_MEDIA_PORTRAIT_MANUAL_BODY,
	type MediaPortraitAdjustments,
	type MediaPortraitManualBodyTool,
} from "@qcut/editor-core";

export const BODY_VIDEO_MATRIX_CONTROLS = [
	{ key: "body_adjust_SmallHead", id: "small-head", label: "小头" },
	{ key: "body_adjust_SwanNeck", id: "swan-neck", label: "天鹅颈" },
	{ key: "body_adjust_SlimArm", id: "slim-arm", label: "瘦手臂" },
	{ key: "body_adjust_OrthoShoulder", id: "ortho-shoulder", label: "直角肩" },
	{ key: "body_adjust_WidenShoulderTest", id: "widen-shoulder", label: "宽肩" },
	{ key: "body_adjust_SlimBody", id: "slim-body", label: "瘦身" },
	{ key: "body_adjust_SlimWaist", id: "slim-waist", label: "瘦腰" },
	{ key: "body_adjust_StretchLeg", id: "stretch-leg", label: "长腿" },
	{ key: "body_adjust_SlimBreast", id: "slim-breast", label: "胸型" },
	{ key: "body_adjust_SlimHip", id: "slim-hip", label: "美胯" },
] as const;

export const BODY_VIDEO_MATRIX_MANUAL_LABELS = {
	stretch: "拉长",
	slim: "瘦身瘦腿",
	zoom: "放大缩小",
} as const;

export interface BodyVideoMatrixCase {
	id: string;
	values: MediaPortraitAdjustments["values"];
	manualBody?: MediaPortraitAdjustments["manualBody"];
	manualTool?: MediaPortraitManualBodyTool;
}

export function bodyVideoMatrixCases(): BodyVideoMatrixCase[] {
	const singles = BODY_VIDEO_MATRIX_CONTROLS.map(({ key, id }) => ({
		id,
		values: { [key]: 40 },
	}));
	const combined = {
		id: "smart-all",
		values: Object.fromEntries(
			BODY_VIDEO_MATRIX_CONTROLS.map(({ key }) => [key, 25])
		),
	};
	const manual = (["stretch", "slim", "zoom"] as const).map((tool) => ({
		id: `smart-manual-${tool}`,
		values: { body_adjust_SlimBody: 40 },
		manualTool: tool,
		manualBody: {
			[tool]: {
				...DEFAULT_MEDIA_PORTRAIT_MANUAL_BODY[tool],
				intensity: { stretch: 12, slim: 16, zoom: 8 }[tool],
			},
		},
	}));
	return [...singles, combined, ...manual];
}

export function bodyVideoMatrixConfig({
	frames = "12",
	cases,
}: {
	frames?: string;
	cases?: string;
} = {}) {
	const count = Number(frames);
	if (!Number.isInteger(count) || count < 6 || count > 24)
		throw new Error("QCUT_BODY_MATRIX_FRAMES must be 6..24 whole frames");
	const all = bodyVideoMatrixCases();
	const ids = cases === undefined ? all.map(({ id }) => id) : cases.split(",");
	if (
		!ids.length ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !all.some((item) => item.id === id))
	)
		throw new Error(
			"QCUT_BODY_MATRIX_CASES must list unique supported case IDs"
		);
	return {
		frames: count,
		fps: 30 as const,
		seconds: count / 30,
		cases: ids.map((id) => all.find((item) => item.id === id)!),
		previewFrames: [count - 1, 0, Math.floor(count / 2)],
		exportFrameBudget: count * (ids.length + 1),
		profile: "swing-coreml-v1" as const,
	};
}

export function matrixCanonicalAdjustments({
	entry,
}: {
	entry: BodyVideoMatrixCase;
}) {
	return {
		values: Object.fromEntries(
			Object.entries(entry.values).map(([key, value]) => [
				key.slice("body_adjust_".length),
				value,
			])
		),
		makeup: {},
		...(entry.manualBody ? { manualBody: entry.manualBody } : {}),
	};
}
