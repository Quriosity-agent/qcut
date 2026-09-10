import {
	JIANYING_TRANSITION_GROUPS,
	type JianyingTransitionGroup,
} from "../../../../../../../../electron/jianying-transition-catalog";
import { JIANYING_LOCAL_TRANSITION_PRESETS } from "./transition-jianying-local-presets";
import { TRANSITION_LAB_PRESETS } from "./transition-lab-presets";
import type { TransitionPreset } from "./transition-preset-types";

export type TransitionLabSource =
	| "all"
	| "qcut"
	| "gl-transitions"
	| "jianying-local";
export type TransitionLabGroup = "all" | JianyingTransitionGroup;

export const JIANYING_LOCAL_TRANSITION_GROUPS =
	JIANYING_TRANSITION_GROUPS.filter(
		(group) => group.id !== "ai-one-take"
	) as ReadonlyArray<{
		id: TransitionLabGroup;
		label: string;
	}>;

// QCut's own clean-room shaders and the vendored gl-transitions are both
// distributable GLSL, but they are not the same thing to a user or a
// reviewer, so the lab counts and filters them as separate sources.
const CLEAN_ROOM_PRESET_COUNT = TRANSITION_LAB_PRESETS.filter(
	(preset) => preset.labOrigin !== "gl-transitions"
).length;
const GL_TRANSITION_PRESET_COUNT = TRANSITION_LAB_PRESETS.filter(
	(preset) => preset.labOrigin === "gl-transitions"
).length;

export const TRANSITION_LAB_SOURCE_OPTIONS = [
	{
		id: "all",
		label: "全部",
		count:
			TRANSITION_LAB_PRESETS.length + JIANYING_LOCAL_TRANSITION_PRESETS.length,
	},
	{ id: "qcut", label: "QCut Shader", count: CLEAN_ROOM_PRESET_COUNT },
	{
		id: "gl-transitions",
		label: "开源 Shader",
		count: GL_TRANSITION_PRESET_COUNT,
	},
	{
		id: "jianying-local",
		label: "本机剪映",
		count: JIANYING_LOCAL_TRANSITION_PRESETS.length,
	},
] as const satisfies ReadonlyArray<{
	id: TransitionLabSource;
	label: string;
	count: number;
}>;

export function filterTransitionLabPresets({
	presets,
	source,
	group,
}: {
	presets: TransitionPreset[];
	source: TransitionLabSource;
	group: TransitionLabGroup;
}): TransitionPreset[] {
	return presets.filter((preset) => {
		const isLocal = preset.backend === "jianying-local";
		const isOpenSource = preset.labOrigin === "gl-transitions";
		if (source === "qcut" && (isLocal || isOpenSource)) return false;
		if (source === "gl-transitions" && !isOpenSource) return false;
		if (source === "jianying-local" && !isLocal) return false;
		if (source !== "jianying-local" || group === "all") return true;
		return preset.jianyingGroup === group;
	});
}

export function getJianyingLocalGroupCount({
	group,
}: {
	group: TransitionLabGroup;
}): number {
	if (group === "all") return JIANYING_LOCAL_TRANSITION_PRESETS.length;
	return JIANYING_LOCAL_TRANSITION_PRESETS.filter(
		(preset) => preset.jianyingGroup === group
	).length;
}
