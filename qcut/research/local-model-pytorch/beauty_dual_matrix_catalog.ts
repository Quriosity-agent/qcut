import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
	JianyingPortraitAdjustmentControl,
	JianyingPortraitAdjustmentRuntimePackage,
	MediaPortraitAdjustmentKey,
	MediaPortraitAdjustments,
} from "../../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	jianyingPortraitControl,
	jianyingPortraitRuntimePackageForControl,
} from "../../electron/jianying-portrait-adjustment-runtime/catalog.js";
import {
	buildJianyingDynamicMakeupParameters,
	buildJianyingStandaloneMakeupParameters,
	JIANYING_PORTRAIT_MAKEUP_CARDS,
} from "../../electron/jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../../electron/jianying-portrait-adjustment-runtime/skin-tone-catalog.js";

export const BEAUTY_DUAL_MATRIX_CONTROL_KEYS = {
	"face-shape": [
		"face_adjust_lunkuopinghua",
		"face_adjust_YouTaiFace",
		"face_adjust_TotalFace",
		"face_adjust_CutFace",
		"face_adjust_XiaHeXian",
		"face_adjust_ZoomJawbone",
		"face_adjust_ZoomCheekbone",
		"face_adjust_SmallFace",
		"face_adjust_VFace",
		"face_adjust_Chin",
		"face_adjust_lower_atrium",
		"face_adjust_mid_atrium",
		"face_adjust_upper_atrium",
	],
	eyes: [
		"face_adjust_EnlargeEye",
		"face_adjust_EyeSpacing",
		"face_adjust_EyeTilted",
		"face_adjust_inner_corner",
		"face_adjust_eye",
		"face_adjust_eye_width",
		"face_adjust_BrightEye",
	],
	nose: [
		"face_adjust_Nose",
		"face_adjust_nose",
		"face_adjust_nose_position",
		"face_adjust_3DNose_Big",
		"face_adjust_MaShengNose",
		"face_adjust_XiaoQiaoBi",
		"face_adjust_TuoFengNose",
	],
	mouth: [
		"face_adjust_ZoomMouth",
		"face_adjust_MouthTilted",
		"face_adjust_Smile",
		"face_adjust_mouse",
		"face_adjust_mouse_width",
		"face_adjust_WhiteTeeth",
	],
	brows: [
		"face_adjust_brow_position",
		"face_adjust_brow_distance",
		"face_adjust_brow_tilt",
		"face_adjust_brow_size",
		"eyebrow_adjust_BiaoZhun",
		"eyebrow_adjust_LiuYe",
		"eyebrow_adjust_JianMei",
	],
	skin: JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
		({ section }) => section === "skin"
	).map(({ key }) => key),
} as const satisfies Record<string, readonly MediaPortraitAdjustmentKey[]>;

export interface BeautyDualMatrixPackageBinding {
	resourceId: string;
	version: string;
	root: string;
	source: "private" | "effect-cache";
	path: string;
	available: boolean;
}

export interface BeautyDualMatrixCase {
	id: string;
	label: string;
	category: keyof typeof BEAUTY_DUAL_MATRIX_CONTROL_KEYS | "makeup";
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
	package: string;
	parameters: Record<string, unknown>;
	dependencies: string[];
	adjustments: MediaPortraitAdjustments;
	/** An intended nonzero effect, never a native-render or parity claim. */
	expectedChange: boolean;
	key: string;
	value: number;
	/** Directory availability only; the parent must hash and validate runtime assets. */
	available: boolean;
	unavailableReasons: string[];
	packageBindings: BeautyDualMatrixPackageBinding[];
	legacyOnly: boolean;
	outOfProductRange: boolean;
	productRange: { min: number; max: number };
	cardId?: string;
	makeupCategory?: string;
	skinToneResourceId?: string;
}

export interface BeautyDualMatrixCatalogOptions {
	runtime: string;
	effectCacheRoot?: string;
	/** Magnitudes are clamped to product bounds; signed controls also emit negatives. */
	levels?: readonly number[];
	includeNegative?: boolean;
	includeLegacyMakeup?: boolean;
}

function validateCanonicalPath({ path }: { path: string }) {
	if (
		!isAbsolute(path) ||
		resolve(path) !== path ||
		/[\x00-\x1f\x7f]/u.test(path)
	) {
		throw new Error("Canonical absolute local runtime/cache path required");
	}
}

function directoryWithoutSymlinks({ path }: { path: string }): boolean {
	const ancestors: string[] = [];
	for (let current = path; ; current = dirname(current)) {
		ancestors.push(current);
		if (dirname(current) === current) break;
	}
	// Walk from the root so even a missing leaf cannot hide a symlinked parent.
	for (const current of ancestors.reverse()) {
		const entry = lstatSync(current, { throwIfNoEntry: false });
		if (!entry) return false;
		if (entry.isSymbolicLink() || !entry.isDirectory()) {
			throw new Error(
				`Pinned package path must be a real directory without symlinks: ${current}`
			);
		}
	}
	return true;
}

function packageBinding({
	runtime,
	effectCacheRoot,
	identities,
}: Pick<BeautyDualMatrixCatalogOptions, "runtime" | "effectCacheRoot"> & {
	identities: readonly { resourceId: string; version: string }[];
}): BeautyDualMatrixPackageBinding {
	const roots: Pick<BeautyDualMatrixPackageBinding, "root" | "source">[] = [
		{ root: join(runtime, "Cache/effect"), source: "private" },
		...(effectCacheRoot
			? [{ root: effectCacheRoot, source: "effect-cache" as const }]
			: []),
	];
	const candidates = identities.flatMap(({ resourceId, version }) =>
		roots.map(({ root, source }) => ({
			resourceId,
			version,
			root,
			source,
			path: join(root, resourceId, version),
			available: false,
		}))
	);
	for (const candidate of candidates) {
		if (directoryWithoutSymlinks({ path: candidate.path })) {
			return { ...candidate, available: true };
		}
	}
	const missing = candidates[0];
	if (!missing)
		throw new Error("At least one pinned package identity required");
	return missing;
}

function caseLevels({
	levels,
	signed,
	includeNegative,
	min,
	max,
}: {
	levels: readonly number[];
	signed: boolean;
	includeNegative: boolean;
	min: number;
	max: number;
}) {
	return [
		...new Set(
			[
				...levels,
				...(signed && includeNegative
					? levels.filter((value) => value > 0).map((value) => -value)
					: []),
			].map((value) => Math.min(max, Math.max(min, value)))
		),
	];
}

function catalogCase({
	baseId,
	title,
	bindings,
	parameterJson,
	...sample
}: Omit<
	BeautyDualMatrixCase,
	| "id"
	| "label"
	| "package"
	| "parameters"
	| "dependencies"
	| "expectedChange"
	| "available"
	| "unavailableReasons"
	| "packageBindings"
	| "outOfProductRange"
> & {
	baseId: string;
	title: string;
	bindings: BeautyDualMatrixPackageBinding[];
	parameterJson: string;
}): BeautyDualMatrixCase {
	const host = bindings[0];
	if (!host) throw new Error("Exactly one host package is required");
	const unavailableReasons = bindings
		.filter(({ available }) => !available)
		.map(({ path }) => `Pinned package directory unavailable: ${path}`);
	const levelId = `${sample.value < 0 ? "n" : "p"}${Math.abs(sample.value)}`;
	return {
		...sample,
		id: `${baseId}-${levelId}`,
		label: `${title} ${sample.value > 0 ? "+" : ""}${sample.value}`,
		package: host.path,
		parameters: JSON.parse(parameterJson) as Record<string, unknown>,
		dependencies: bindings.map(({ path }) => path),
		expectedChange: sample.value !== 0,
		available: unavailableReasons.length === 0,
		unavailableReasons,
		packageBindings: bindings,
		outOfProductRange:
			sample.value < sample.productRange.min ||
			sample.value > sample.productRange.max,
	};
}

function controlCases({
	control,
	category,
	baseId,
	title,
	binding,
	levels,
	includeNegative,
	skinToneResourceId,
}: {
	control: JianyingPortraitAdjustmentControl;
	category: BeautyDualMatrixCase["category"];
	baseId: string;
	title: string;
	binding: BeautyDualMatrixPackageBinding;
	levels: readonly number[];
	includeNegative: boolean;
	skinToneResourceId?: MediaPortraitAdjustments["skinToneResourceId"];
}): BeautyDualMatrixCase[] {
	const runtimePackage = jianyingPortraitRuntimePackageForControl({ control });
	return caseLevels({
		levels,
		signed: control.min < 0,
		includeNegative,
		min: control.min,
		max: control.max,
	}).map((value) => {
		const values = { [control.key]: value };
		return catalogCase({
			baseId,
			title,
			category,
			runtimePackage,
			bindings: [binding],
			parameterJson: buildJianyingPortraitFeatureParameters({
				runtimePackage,
				values,
				targetFaceId: -1,
			}),
			adjustments: {
				enabled: true,
				values,
				...(skinToneResourceId ? { skinToneResourceId } : {}),
			},
			key: control.key,
			value,
			legacyOnly: false,
			productRange: { min: control.min, max: control.max },
			...(skinToneResourceId ? { skinToneResourceId } : {}),
		});
	});
}

export function beautyDualMatrixCatalog({
	runtime,
	effectCacheRoot,
	levels = [40, 80],
	includeNegative = true,
	includeLegacyMakeup = true,
}: BeautyDualMatrixCatalogOptions): BeautyDualMatrixCase[] {
	validateCanonicalPath({ path: runtime });
	directoryWithoutSymlinks({ path: runtime });
	if (effectCacheRoot !== undefined) {
		validateCanonicalPath({ path: effectCacheRoot });
		if (!directoryWithoutSymlinks({ path: effectCacheRoot })) {
			throw new Error(
				"Explicit effect cache root must be an existing directory"
			);
		}
	}
	if (
		levels.length === 0 ||
		levels.some((value) => !Number.isFinite(value) || value < 0 || value > 100)
	) {
		throw new Error("Probe levels must be finite magnitudes between 0 and 100");
	}
	const resolveBinding = ({
		identities,
	}: {
		identities: readonly { resourceId: string; version: string }[];
	}) => packageBinding({ runtime, effectCacheRoot, identities });
	const controls = Object.entries(BEAUTY_DUAL_MATRIX_CONTROL_KEYS).flatMap(
		([category, keys]) =>
			keys.flatMap((key) => {
				const control = jianyingPortraitControl({ key });
				if (!control) throw new Error(`Product control unavailable: ${key}`);
				const runtimePackage = jianyingPortraitRuntimePackageForControl({
					control,
				});
				return controlCases({
					control,
					category: category as keyof typeof BEAUTY_DUAL_MATRIX_CONTROL_KEYS,
					baseId: key,
					title: control.titleEn,
					binding: resolveBinding({
						identities: [JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage]],
					}),
					levels,
					includeNegative,
				});
			})
	);
	const skinControl = jianyingPortraitControl({
		key: "face_adjust_skin_Intensity",
	});
	if (!skinControl) throw new Error("Product skin-tone control unavailable");
	const skinTones = JIANYING_PORTRAIT_SKIN_TONES.flatMap((tone) => {
		const legacy = JIANYING_PORTRAIT_PACKAGE_IDENTITIES["skin-tone"];
		// Match the product resolver: selected pink prefers the legacy package.
		const identities = [
			...(tone.resourceId === legacy.resourceId ? [legacy] : []),
			tone,
		];
		return controlCases({
			control: skinControl,
			category: "skin",
			baseId: `skin-tone-${tone.resourceId}`,
			title: tone.titleEn,
			binding: resolveBinding({ identities }),
			levels,
			includeNegative,
			skinToneResourceId: tone.resourceId,
		});
	});
	const makeup = JIANYING_PORTRAIT_MAKEUP_CARDS.filter(
		(card) => includeLegacyMakeup || !card.legacyOnly
	).flatMap((card) => {
		const cardBinding = resolveBinding({ identities: [card] });
		const bindings =
			card.kind === "dynamic"
				? [
						resolveBinding({
							identities: [JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup],
						}),
						cardBinding,
					]
				: [cardBinding];
		return caseLevels({
			levels,
			signed: false,
			includeNegative,
			min: 0,
			max: 100,
		}).map((value) =>
			catalogCase({
				baseId: `makeup-${card.id}`,
				title: card.titleEn,
				category: "makeup",
				runtimePackage: "makeup",
				bindings,
				parameterJson:
					card.kind === "dynamic"
						? buildJianyingDynamicMakeupParameters({
								selections: [
									{ card, intensity: value, packagePath: cardBinding.path },
								],
								targetFaceId: -1,
							})
						: buildJianyingStandaloneMakeupParameters({
								card,
								intensity: value,
								targetFaceId: -1,
							}),
				adjustments: {
					enabled: true,
					values: {},
					makeup: { [card.category]: { cardId: card.id, intensity: value } },
				},
				key: card.parameterKey,
				value,
				cardId: card.id,
				makeupCategory: card.category,
				legacyOnly: card.legacyOnly === true,
				productRange: { min: 0, max: 100 },
			})
		);
	});
	return [...controls, ...skinTones, ...makeup];
}

if (import.meta.main) {
	if (process.argv.length !== 3 && process.argv.length !== 4) {
		throw new Error(
			"Usage: bun beauty_dual_matrix_catalog.ts ABSOLUTE_RUNTIME [ABSOLUTE_EFFECT_CACHE_ROOT]"
		);
	}
	console.log(
		JSON.stringify(
			beautyDualMatrixCatalog({
				runtime: process.argv[2],
				effectCacheRoot: process.argv[3],
			})
		)
	);
}
