import catalog from "../research/independent-beauty/research/independent-pipeline-catalog.json";
import type {
	MediaPortraitAdjustmentKey,
	MediaPortraitAdjustments,
	MediaPortraitMakeupCategory,
} from "../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";

export interface BeautyMatrixCase {
	id: string;
	kind: "zero" | "control" | "makeup" | "composite";
	adjustments: MediaPortraitAdjustments;
}

function controls({ values }: { values: Record<string, number> }) {
	return Object.fromEntries(
		Object.entries(values).map(([name, value]) => [
			`face_adjust_${name}`,
			value,
		])
	) as Partial<Record<MediaPortraitAdjustmentKey, number>>;
}

function composite({
	id,
	values,
	makeup = {},
}: {
	id: string;
	values: Record<string, number>;
	makeup?: MediaPortraitAdjustments["makeup"];
}): BeautyMatrixCase {
	return {
		id,
		kind: "composite",
		adjustments: { enabled: true, values: controls({ values }), makeup },
	};
}

export function beautyMatrixCases({
	includeMidpoints = false,
}: {
	includeMidpoints?: boolean;
} = {}): BeautyMatrixCase[] {
	const cases: BeautyMatrixCase[] = [
		{ id: "zero", kind: "zero", adjustments: { enabled: true, values: {} } },
	];
	for (const control of catalog.controls) {
		const boundaries =
			control.min < 0 ? [control.min, control.max] : [control.max];
		const levels = includeMidpoints
			? [...boundaries, ...boundaries.map((value) => value / 2)]
			: boundaries;
		for (const value of levels) {
			cases.push({
				id: `control-${control.name}-${value}`,
				kind: "control",
				adjustments: {
					enabled: true,
					values: controls({ values: { [control.name]: value } }),
				},
			});
		}
	}
	for (const card of catalog.makeup) {
		for (const intensity of includeMidpoints ? [35, 100] : [100]) {
			cases.push({
				id: `makeup-${card.id}-${intensity}`,
				kind: "makeup",
				adjustments: {
					enabled: true,
					values: {},
					makeup: {
						[card.category as MediaPortraitMakeupCategory]: {
							cardId: card.id,
							intensity,
						},
					},
				},
			});
		}
	}
	return cases.concat([
		composite({
			id: "shape-features",
			values: {
				TotalFace: 35,
				Chin: -20,
				EnlargeEye: 20,
				Nose: 25,
				MouthCorner: 30,
				CornerEye: 30,
			},
		}),
		composite({
			id: "local-six",
			values: {
				underjaw: 25,
				pointy_chin: -25,
				cheekbone: 25,
				upper_atrium: -25,
				mid_atrium: 25,
				lower_atrium: -25,
			},
		}),
		composite({
			id: "face-local",
			values: { TotalFace: 35, Nose: 25, underjaw: 25, cheekbone: -25 },
		}),
		composite({
			id: "skin-shape-lip",
			values: { Whiten: 45, Smooth: 30, TotalFace: 35, Nose: 25 },
			makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
		}),
		composite({
			id: "skin-gan-shape",
			values: {
				Whiten: 35,
				yunfu: 30,
				fuling: 30,
				lunkuopinghua: 30,
				XiaHeXian: 35,
			},
		}),
		composite({
			id: "eye-three",
			values: {},
			makeup: {
				eyeliner: { cardId: "eyeliner-warrior", intensity: 80 },
				aegyo: { cardId: "aegyo-peach", intensity: 80 },
				eyeshadow: { cardId: "eyeshadow-girl-pink", intensity: 80 },
			},
		}),
		composite({
			id: "pigment-seven",
			values: {},
			makeup: {
				lip: { cardId: "lip-soft-pink", intensity: 60 },
				brows: { cardId: "brows-soft", intensity: 60 },
				blush: { cardId: "blush-baby-pink", intensity: 60 },
				contour: { cardId: "contour-mixed", intensity: 60 },
				eyeliner: { cardId: "eyeliner-natural", intensity: 60 },
				aegyo: { cardId: "aegyo-natural", intensity: 60 },
				eyeshadow: { cardId: "eyeshadow-girl-pink", intensity: 60 },
			},
		}),
	]);
}

export function matrixSelection({
	suite,
}: {
	suite: "full" | "stress" | "shape";
}) {
	const all = beautyMatrixCases();
	if (suite === "full") return all;
	const ids =
		suite === "shape"
			? ["zero", "shape-features", "local-six", "face-local"]
			: [
					"zero",
					"shape-features",
					"local-six",
					"skin-shape-lip",
					"eye-three",
					"pigment-seven",
				];
	return all.filter(({ id }) => ids.includes(id));
}
