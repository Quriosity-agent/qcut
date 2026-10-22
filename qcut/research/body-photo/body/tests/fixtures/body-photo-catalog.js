import legacy from "../../catalog.json";

export const extraControls = [
	["Abdomen", "独立收腹", 0, 100, "abdomen"],
	["ButtLift", "提臀", 0, 100, "buttocks"],
	["ButtShape", "臀型宽度", -50, 50, "buttocks"],
	["LegStraighten", "腿型拉直", 0, 100, "legs"],
	["AnkleWidth", "脚踝粗细", -50, 50, "legs"],
	["BodySkinTone", "身体明暗", -50, 50, "skin"],
	["BodySkinWarmth", "身体冷暖", -50, 50, "skin"],
	["BodySkinSmooth", "身体磨皮", 0, 100, "skin"],
	["BodyBlemish", "淡化小瑕疵", 0, 100, "skin"],
].map(([name, title, min, max, group]) => ({ name, title, min, max, group, default: 0, step: 1,
	note: name === "ButtShape" ? "改变二维轮廓，不生成侧面立体体积。" : `${title}按可见部位判断。` }));

export const photoGroups = [
	{ id: "proportion", title: "整体比例" }, { id: "upper", title: "肩颈与上身" },
	{ id: "abdomen", title: "腰腹" }, { id: "buttocks", title: "胯部与臀型" },
	{ id: "legs", title: "腿部与脚踝" }, { id: "skin", title: "身体肤色与皮肤" },
];

export function photoCatalog({ extended = true } = {}) {
	return structuredClone({
		...legacy,
		controls: [...legacy.controls, ...(extended ? extraControls : [])],
		...(extended ? { groups: photoGroups } : {}),
		platform: { supported: true, backend: extended ? "portable-CPU" : "macOS-Metal" },
	});
}
