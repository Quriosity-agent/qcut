import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	isPortraitSkinToneKey,
	JIANYING_PORTRAIT_SKIN_DEFAULT_INTENSITY,
} from "../../../../../electron/jianying-portrait-adjustment-runtime/skin-tone-catalog";

export function withoutSkinToneValues({
	values,
}: {
	values: MediaPortraitAdjustments["values"];
}) {
	return Object.fromEntries(
		Object.entries(values).filter(([key]) => !isPortraitSkinToneKey({ key }))
	);
}

export function applyGlobalPortraitSkinTone({
	adjustments,
	edited,
}: {
	adjustments: MediaPortraitAdjustments;
	edited: MediaPortraitAdjustments;
}): MediaPortraitAdjustments {
	if (edited.skinToneResourceId === undefined) return adjustments;
	const selected = selectPortraitSkinTone({
		adjustments,
		resourceId: edited.skinToneResourceId,
	});
	return {
		...selected,
		values: {
			...withoutSkinToneValues({ values: selected.values }),
			...(edited.skinToneResourceId === null
				? {}
				: Object.fromEntries(
						Object.entries(edited.values).filter(([key]) =>
							isPortraitSkinToneKey({ key })
						)
					)),
		},
	};
}

export function selectPortraitSkinTone({
	adjustments,
	resourceId,
}: {
	adjustments: MediaPortraitAdjustments;
	resourceId?: MediaPortraitAdjustments["skinToneResourceId"];
}): MediaPortraitAdjustments {
	const { skinToneResourceId: previous, ...rest } = adjustments;
	const faces = adjustments.faces?.flatMap((face) => {
		const values = withoutSkinToneValues({ values: face.values });
		return Object.values(values).some((value) => value !== 0) ||
			Object.keys(face.makeup ?? {}).length > 0
			? [{ ...face, values }]
			: [];
	});
	const cleared = {
		...rest,
		...(faces ? { faces: faces.length ? faces : undefined } : {}),
	};
	if (resourceId === undefined || resourceId === null) {
		return {
			...cleared,
			skinToneResourceId: null,
			values: withoutSkinToneValues({ values: adjustments.values }),
		};
	}
	const values =
		previous === null
			? withoutSkinToneValues({ values: adjustments.values })
			: adjustments.values;
	const hasSkinValues =
		(values.face_adjust_skin_Intensity ?? 0) !== 0 ||
		(values.face_adjust_skin_ColdWarm ?? 0) !== 0;
	return {
		...cleared,
		enabled: true,
		skinToneResourceId: resourceId,
		values: {
			...values,
			...(!previous && !hasSkinValues
				? {
						face_adjust_skin_Intensity:
							JIANYING_PORTRAIT_SKIN_DEFAULT_INTENSITY,
					}
				: {}),
		},
	};
}
