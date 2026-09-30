import type {
	JianyingPortraitAdjustmentControl,
	JianyingPortraitAdjustmentGroup,
	JianyingPortraitAdjustmentRuntimePackage,
	MediaPortraitAdjustmentKey,
} from "../jianying-portrait-adjustment-contract.js";
import { JIANYING_PORTRAIT_ADVANCED_CONTROLS } from "./advanced-controls.js";

export const JIANYING_PORTRAIT_PACKAGE_IDENTITIES = {
	smooth: {
		resourceId: "7408077820116667700",
		version: "b000f31572be3e5f9fd195d7bba37968",
		group: "face",
	},
	whiten: {
		resourceId: "7408028287785602319",
		version: "8615dc8c263df7e22740b76b0ac497f8",
		group: "face",
	},
	clarity: {
		resourceId: "7598460431144963366",
		version: "d8d3201fa6c77f369501cf4baae130ab",
		group: "face",
	},
	// Skin correction and contour flow share a GAN package with independent keys.
	"skin-gan": {
		resourceId: "7408077026705280256",
		version: "74ded1bf06987b66866e6c2fc72a9e24",
		group: "face",
	},
	"small-face": {
		resourceId: "7406181120506678580",
		version: "51c8fe396e4ba74acdb7bf73058a7fbe",
		group: "face",
	},
	jawline: {
		resourceId: "7493863675460160807",
		version: "e234219f691efcb6bcdbf9c60d2c58ea",
		group: "face",
	},
	"spot-acne": {
		resourceId: "7442228961163088434",
		version: "e8b424917121b52fc69cba119274cc47",
		group: "face",
	},
	"manual-smooth": {
		resourceId: "7447725847449965107",
		version: "cdadab3125d2a44f561cca947057977f",
		group: "face",
	},
	"manual-acne": {
		resourceId: "7456626609332687397",
		version: "4375341231235e0656e15dcc64c49b39",
		group: "face",
	},
	"manual-deformation": {
		resourceId: "7408028088627465524",
		version: "e607793158bce9c274fe73722ec983fb",
		group: "face",
	},
	"manual-stretch": {
		resourceId: "7406180541361392896",
		version: "842ae3d2c0e00271729129fc90f59712",
		group: "body",
	},
	"manual-slim": {
		resourceId: "7406017234474175796",
		version: "08af2313acd311315abf352ff737264e",
		group: "body",
	},
	"manual-zoom": {
		resourceId: "7406174489727339791",
		version: "f21ee9174404341a6b01d792db7366db",
		group: "body",
	},
	face: {
		resourceId: "7408077448513998114",
		version: "aa4932200616e291a252039a3aac7232",
		group: "face",
	},
	features: {
		resourceId: "7408077472211668276",
		version: "f662ff9c955ee319f1ae03b2aa27df76",
		group: "face",
	},
	"feature-tilt": {
		resourceId: "7406181636397616419",
		version: "73eaa893dad063f175650f9fcf144f0a",
		group: "face",
	},
	smile: {
		resourceId: "7406174614939880704",
		version: "51d0a761ae1ce8c88b23fb414d009a91",
		group: "face",
	},
	"nose-3d": {
		resourceId: "7408077058544323874",
		version: "d7c908c833ac8ffc0de910ec579ba339",
		group: "face",
	},
	"nose-sculpt": {
		resourceId: "7406179927055273250",
		version: "e9b672ca3c8c3a21eed297586e4aafab",
		group: "face",
	},
	"nose-upturned": {
		resourceId: "7406180734387359010",
		version: "b428316fa25cc1924b1a29e6394af149",
		group: "face",
	},
	"nose-hump": {
		resourceId: "7406018149583310114",
		version: "fbb628af927c81ce06285991a1227dd3",
		group: "face",
	},
	"brow-shape": {
		resourceId: "7406174746829737231",
		version: "07099f3faae54f150b43ab47e1b94521",
		group: "face",
	},
	"eye-details": {
		resourceId: "7408077446257331471",
		version: "a5ff2cc5d18c0f1ba8803b2550be679d",
		group: "face",
	},
	"skin-tone": {
		resourceId: "7408757645705760000",
		version: "c36221f2a2097535ce1a2f70cd9e0116",
		group: "face",
	},
	teeth: {
		resourceId: "7408077691880049960",
		version: "314c864e3cac447612ba24e8261eab31",
		group: "face",
	},
	makeup: {
		resourceId: "21769690",
		version: "89ad943ef61e4509b877db7105e3216e",
		group: "face",
	},
	body: {
		resourceId: "7408076932065152296",
		version: "9c891b188dd6b523a30efa8bfb63602b",
		group: "body",
	},
} as const;

export const JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER = [
	"smooth",
	"whiten",
	"clarity",
	"spot-acne",
	"skin-gan",
	"manual-smooth",
	"manual-acne",
	"manual-deformation",
	"manual-stretch",
	"manual-slim",
	"manual-zoom",
	"eye-details",
	"skin-tone",
	"teeth",
	"face",
	"features",
	"small-face",
	"jawline",
	"feature-tilt",
	"smile",
	"nose-3d",
	"nose-sculpt",
	"nose-upturned",
	"nose-hump",
	"brow-shape",
	"makeup",
	"body",
] as const satisfies readonly JianyingPortraitAdjustmentRuntimePackage[];

export const JIANYING_PORTRAIT_ADJUSTMENT_CATALOG = [
	{
		key: "face_adjust_Smooth",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "smooth",
		titleZh: "磨皮",
		titleEn: "Smooth",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_Whiten",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "whiten",
		titleZh: "美白",
		titleEn: "Whiten",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_yunfu",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "skin-gan",
		titleZh: "匀肤",
		titleEn: "Even skin",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_fuling",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "skin-gan",
		titleZh: "丰盈",
		titleEn: "Plump",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_SpotAcne",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "spot-acne",
		titleZh: "祛斑祛痘",
		titleEn: "Remove blemishes",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_NasolabialFolds",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "eye-details",
		titleZh: "祛法令纹",
		titleEn: "Reduce smile lines",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_Pouch",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "eye-details",
		titleZh: "祛黑眼圈",
		titleEn: "Reduce dark circles",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_Clarity",
		group: "face",
		section: "skin",
		category: "skin",
		runtimePackage: "clarity",
		titleZh: "清晰",
		titleEn: "Clarity",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_lunkuopinghua",
		group: "face",
		section: "face-shape",
		runtimePackage: "skin-gan",
		titleZh: "流畅脸",
		titleEn: "Smooth contour",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_YouTaiFace",
		group: "face",
		section: "face-shape",
		runtimePackage: "small-face",
		titleZh: "小脸",
		titleEn: "Small face",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_TotalFace",
		group: "face",
		section: "face-shape",
		titleZh: "瘦脸",
		titleEn: "Slim face",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_CutFace",
		group: "face",
		section: "face-shape",
		titleZh: "窄脸",
		titleEn: "Narrow face",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_XiaHeXian",
		group: "face",
		section: "face-shape",
		runtimePackage: "jawline",
		titleZh: "下颌线",
		titleEn: "Jawline",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_ZoomJawbone",
		group: "face",
		section: "face-shape",
		titleZh: "下颌骨",
		titleEn: "Jawbone",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_ZoomCheekbone",
		group: "face",
		section: "face-shape",
		titleZh: "颧骨",
		titleEn: "Cheekbone",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_SmallFace",
		group: "face",
		section: "face-shape",
		titleZh: "短脸",
		titleEn: "Short face",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_VFace",
		group: "face",
		section: "face-shape",
		titleZh: "V脸",
		titleEn: "V face",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_Chin",
		group: "face",
		section: "face-shape",
		titleZh: "下巴长短",
		titleEn: "Chin length",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_lower_atrium",
		group: "face",
		section: "face-shape",
		category: "common",
		runtimePackage: "features",
		titleZh: "下庭",
		titleEn: "Lower face",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_mid_atrium",
		group: "face",
		section: "face-shape",
		category: "common",
		runtimePackage: "features",
		titleZh: "中庭",
		titleEn: "Mid face",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_upper_atrium",
		group: "face",
		section: "face-shape",
		category: "common",
		runtimePackage: "features",
		titleZh: "上庭",
		titleEn: "Upper face",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_ChinSharp",
		group: "face",
		section: "face-shape",
		titleZh: "尖下巴",
		titleEn: "Pointed chin",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_Forehead",
		group: "face",
		section: "face-shape",
		titleZh: "发际线",
		titleEn: "Hairline",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_temple",
		group: "face",
		section: "features",
		category: "details",
		runtimePackage: "features",
		titleZh: "太阳穴（基础）",
		titleEn: "Temples (legacy)",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_cheekbone",
		group: "face",
		section: "face-shape",
		category: "common",
		runtimePackage: "features",
		titleZh: "颧弓",
		titleEn: "Cheek arch",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_pointy_chin",
		group: "face",
		section: "face-shape",
		category: "common",
		runtimePackage: "features",
		titleZh: "下巴",
		titleEn: "Chin shape",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_jaw",
		group: "face",
		section: "features",
		category: "details",
		runtimePackage: "features",
		titleZh: "下巴轮廓（基础）",
		titleEn: "Chin contour (legacy)",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_underjaw",
		group: "face",
		section: "face-shape",
		category: "common",
		runtimePackage: "features",
		titleZh: "下颌角",
		titleEn: "Jaw angle",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_EnlargeEye",
		group: "face",
		section: "features",
		category: "eyes",
		titleZh: "大眼",
		titleEn: "Enlarge eyes",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_BrightEye",
		group: "face",
		section: "features",
		category: "eyes",
		runtimePackage: "eye-details",
		titleZh: "亮眼",
		titleEn: "Bright eyes",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_EyeSpacing",
		group: "face",
		section: "features",
		category: "eyes",
		titleZh: "眼距",
		titleEn: "Eye spacing",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_inner_corner",
		group: "face",
		section: "features",
		category: "eyes",
		runtimePackage: "features",
		titleZh: "开眼角",
		titleEn: "Open eye corners",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_MoveEye",
		group: "face",
		section: "features",
		category: "eyes",
		titleZh: "眼高低",
		titleEn: "Eye height",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_EyeTilted",
		group: "face",
		section: "features",
		category: "eyes",
		runtimePackage: "feature-tilt",
		titleZh: "眼倾斜",
		titleEn: "Eye tilt",
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_CornerEye",
		group: "face",
		section: "features",
		category: "details",
		titleZh: "眼角扩张（基础）",
		titleEn: "Eye corners (classic)",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_Nose",
		group: "face",
		section: "features",
		category: "nose",
		titleZh: "瘦鼻",
		titleEn: "Slim nose",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_MoveNose",
		group: "face",
		section: "features",
		category: "details",
		titleZh: "鼻部位移（基础）",
		titleEn: "Nose shift (classic)",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_WhiteTeeth",
		group: "face",
		section: "features",
		category: "mouth",
		runtimePackage: "teeth",
		titleZh: "白牙",
		titleEn: "Whiten teeth",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_ZoomMouth",
		group: "face",
		section: "features",
		category: "mouth",
		titleZh: "嘴大小",
		titleEn: "Mouth size",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_MoveMouth",
		group: "face",
		section: "features",
		category: "mouth",
		titleZh: "嘴高低",
		titleEn: "Mouth height",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_MouthTilted",
		group: "face",
		section: "features",
		category: "mouth",
		runtimePackage: "feature-tilt",
		titleZh: "嘴倾斜",
		titleEn: "Mouth tilt",
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_MouthCorner",
		group: "face",
		section: "features",
		category: "details",
		titleZh: "嘴角（基础）",
		titleEn: "Mouth corners (classic)",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "face_adjust_mouse_corner",
		group: "face",
		section: "features",
		category: "mouth",
		runtimePackage: "features",
		titleZh: "微笑唇",
		titleEn: "Smile lips",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_Smile",
		group: "face",
		section: "features",
		category: "mouth",
		runtimePackage: "smile",
		titleZh: "笑容",
		titleEn: "Smile",
		min: -100,
		max: 100,
		step: 1,
	},
	...JIANYING_PORTRAIT_ADVANCED_CONTROLS,
	{
		key: "body_adjust_SmallHead",
		group: "body",
		section: "body",
		titleZh: "小头",
		titleEn: "Small head",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_SwanNeck",
		group: "body",
		section: "body",
		titleZh: "天鹅颈",
		titleEn: "Swan neck",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_SlimArm",
		group: "body",
		section: "body",
		titleZh: "瘦手臂",
		titleEn: "Slim arms",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_OrthoShoulder",
		group: "body",
		section: "body",
		titleZh: "直角肩",
		titleEn: "Square shoulders",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_WidenShoulderTest",
		group: "body",
		section: "body",
		titleZh: "宽肩",
		titleEn: "Shoulder width",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "body_adjust_SlimBody",
		group: "body",
		section: "body",
		titleZh: "瘦身",
		titleEn: "Slim body",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_SlimWaist",
		group: "body",
		section: "body",
		titleZh: "瘦腰",
		titleEn: "Slim waist",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_StretchLeg",
		group: "body",
		section: "body",
		titleZh: "长腿",
		titleEn: "Long legs",
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "body_adjust_SlimBreast",
		group: "body",
		section: "body",
		titleZh: "胸型",
		titleEn: "Bust",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "body_adjust_SlimHip",
		group: "body",
		section: "body",
		titleZh: "美胯",
		titleEn: "Hip shape",
		min: -50,
		max: 50,
		step: 1,
	},
] as const satisfies readonly JianyingPortraitAdjustmentControl[];

const CONTROL_BY_KEY = new Map(
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.map((control) => [control.key, control])
);

export function jianyingPortraitControl({
	key,
}: {
	key: string;
}): JianyingPortraitAdjustmentControl | undefined {
	return CONTROL_BY_KEY.get(key as MediaPortraitAdjustmentKey);
}

export function jianyingPortraitControlsForGroup({
	group,
}: {
	group: JianyingPortraitAdjustmentGroup;
}) {
	return JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
		(control) => control.group === group
	);
}

export function jianyingPortraitRuntimePackageForControl({
	control,
}: {
	control: JianyingPortraitAdjustmentControl;
}): JianyingPortraitAdjustmentRuntimePackage {
	return control.runtimePackage ?? control.group;
}

export function jianyingPortraitControlsForRuntimePackage({
	runtimePackage,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
}) {
	return JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
		(control) =>
			jianyingPortraitRuntimePackageForControl({ control }) === runtimePackage
	);
}

/**
 * One face's worth of slider values for parameter emission. The id is the
 * native vector-protocol face id: -1 means "any face", otherwise a freid
 * trackid (package Lua getValue matches an id-equal entry before the -1
 * fallback).
 */
export interface JianyingPortraitFaceParameterEntry {
	id: number;
	values: Partial<Record<MediaPortraitAdjustmentKey, number>>;
}

export function buildJianyingPortraitFeatureParameters({
	runtimePackage,
	values,
	targetFaceId = -1,
	faceEntries,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
	values: Partial<Record<MediaPortraitAdjustmentKey, number>>;
	targetFaceId?: number;
	/**
	 * Additional per-face entries appended after the base entry. Absent means
	 * legacy single-face emission, byte-identical to the historical output.
	 */
	faceEntries?: readonly JianyingPortraitFaceParameterEntry[];
}) {
	const entries: readonly JianyingPortraitFaceParameterEntry[] = [
		{ id: targetFaceId, values },
		...(faceEntries ?? []),
	];
	// 三个标量包（磨皮/美白/清晰）的 Lua 只接受 {intensity} 标量事件，
	// 向量形式未经探针验证前始终只从基础条目取值，逐脸数据在上游保留。
	if (runtimePackage === "smooth") {
		return JSON.stringify({
			intensity: (values.face_adjust_Smooth ?? 0) / 100,
		});
	}
	// 美白包的出厂默认强度是 1.0（不下发参数就是满强度），因此这里必须
	// 总是显式携带 intensity；清晰包默认为 0，同一形状保持对称。
	if (runtimePackage === "whiten") {
		return JSON.stringify({
			intensity: (values.face_adjust_Whiten ?? 0) / 100,
		});
	}
	if (runtimePackage === "clarity") {
		return JSON.stringify({
			intensity: (values.face_adjust_Clarity ?? 0) / 100,
		});
	}
	// The body package reads only the FIRST vector element and never looks at
	// its id (`slimbody.lua` handleIntensityEvent: `inputValue:get(0)` then
	// `inputMap:get("intensity")`). Body adjustments are therefore whole-frame
	// and cannot target one person — and emitting a multi-entry vector would
	// break them outright, because a zero-valued base entry would shadow every
	// per-face value behind it.
	const isWholeFrameVectorPackage = runtimePackage === "body";
	const vectorFor = (key: MediaPortraitAdjustmentKey) => {
		if (isWholeFrameVectorPackage) {
			const effective =
				entries.find((entry) => (entry.values[key] ?? 0) !== 0) ?? entries[0];
			return [
				{
					id: -1,
					intensity: (effective?.values[key] ?? 0) / 100,
				},
			];
		}
		return entries.map((entry) => ({
			id: entry.id,
			intensity: (entry.values[key] ?? 0) / 100,
		}));
	};
	// 祛斑祛痘包内部的键就叫 `face_adjust`（与洁牙同名、不同包），
	// 产品键单独命名以免两张卡互相覆盖。
	if (runtimePackage === "spot-acne") {
		return JSON.stringify({ face_adjust: vectorFor("face_adjust_SpotAcne") });
	}
	if (runtimePackage === "teeth") {
		return JSON.stringify({ face_adjust: vectorFor("face_adjust_WhiteTeeth") });
	}
	// The smile package reuses SmallFace; keep its project value separate from short face.
	if (runtimePackage === "smile") {
		return JSON.stringify({
			face_adjust_SmallFace: vectorFor("face_adjust_Smile"),
		});
	}
	return JSON.stringify(
		Object.fromEntries(
			jianyingPortraitControlsForRuntimePackage({ runtimePackage }).map(
				(control) => [control.key, vectorFor(control.key)]
			)
		)
	);
}
