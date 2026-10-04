import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	jianyingPortraitControl,
	jianyingPortraitRuntimePackageForControl,
} from "../../electron/jianying-portrait-adjustment-runtime/catalog.js";
import {
	buildJianyingDynamicMakeupParameters,
	jianyingPortraitMakeupCard,
} from "../../electron/jianying-portrait-adjustment-runtime/makeup-catalog.js";

const selections = [
	{ id: "eye", key: "face_adjust_eye", value: 40 },
	{ id: "nose", key: "face_adjust_nose", value: 40 },
	{ id: "jaw", key: "face_adjust_XiaHeXian", value: 80 },
	{ id: "mouth", key: "face_adjust_mouse", value: 40 },
	{ id: "skin", key: "face_adjust_Smooth", value: 50 },
] as const;

function directoryWithoutSymlinks({ path }: { path: string }) {
	if (!lstatSync(path).isDirectory()) return false;
	// APFS realpath may normalize casing even when there is no symlink.
	for (let current = path; ; current = dirname(current)) {
		if (lstatSync(current).isSymbolicLink()) return false;
		if (dirname(current) === current) return true;
	}
}

function packageBinding({
	runtime,
	identity,
	effectCacheRoot,
}: {
	runtime: string;
	identity: { resourceId: string; version: string };
	effectCacheRoot?: string;
}) {
	const candidates = [
		{ root: join(runtime, "Cache/effect"), source: "private" },
		...(effectCacheRoot
			? [{ root: effectCacheRoot, source: "effect-cache" }]
			: []),
	];
	for (const { root, source } of candidates) {
		const path = join(root, identity.resourceId, identity.version);
		const entry = lstatSync(path, { throwIfNoEntry: false });
		if (!entry) continue;
		if (!directoryWithoutSymlinks({ path })) {
			throw new Error(
				`Pinned package must be a real directory without symlink escape: ${path}`
			);
		}
		return { ...identity, root, source, path, available: true };
	}
	return {
		...identity,
		...candidates[0],
		path: join(candidates[0].root, identity.resourceId, identity.version),
		available: false,
	};
}

export function featureCatalog({
	runtime,
	effectCacheRoot,
}: {
	runtime: string;
	effectCacheRoot?: string;
}) {
	for (const path of [runtime, ...(effectCacheRoot ? [effectCacheRoot] : [])]) {
		if (
			!isAbsolute(path) ||
			resolve(path) !== path ||
			/[\x00\r\n\t]/u.test(path)
		) {
			throw new Error("Canonical absolute local runtime/cache path required");
		}
	}
	if (effectCacheRoot && !directoryWithoutSymlinks({ path: effectCacheRoot })) {
		throw new Error(
			"Explicit effect cache root must be a real directory without symlinks"
		);
	}
	const features = selections.map(({ id, key, value }) => {
		const control = jianyingPortraitControl({ key });
		if (!control || value < control.min || value > control.max) {
			throw new Error(`Unsupported campaign control: ${key}`);
		}
		const runtimePackage = jianyingPortraitRuntimePackageForControl({
			control,
		});
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage];
		const binding = packageBinding({ runtime, identity, effectCacheRoot });
		const hostPackage = binding.path;
		const parameters = Object.fromEntries(
			(
				[
					["active", value],
					["half", value / 2],
					["zero", 0],
				] as const
			).map(([level, intensity]) => [
				level,
				JSON.parse(
					buildJianyingPortraitFeatureParameters({
						runtimePackage,
						values: { [key]: intensity },
						targetFaceId: -1,
					})
				),
			])
		);
		return {
			id,
			key,
			value,
			runtimePackage,
			hostPackage,
			packages: [hostPackage],
			packageBindings: [binding],
			parameters,
		};
	});
	const card = jianyingPortraitMakeupCard({ id: "lip-soft-pink" });
	if (!card || card.kind !== "dynamic") {
		throw new Error("Expected dynamic lip-soft-pink makeup card");
	}
	const hostBinding = packageBinding({
		runtime,
		identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup,
		effectCacheRoot,
	});
	const cardBinding = packageBinding({
		runtime,
		identity: card,
		effectCacheRoot,
	});
	const hostPackage = hostBinding.path;
	const cardPackage = cardBinding.path;
	const parameters = Object.fromEntries(
		(
			[
				["active", 80],
				["half", 40],
				["zero", 0],
			] as const
		).map(([level, intensity]) => [
			level,
			JSON.parse(
				buildJianyingDynamicMakeupParameters({
					selections: [{ card, intensity, packagePath: cardPackage }],
					targetFaceId: -1,
				})
			),
		])
	);
	return [
		...features,
		{
			id: "makeup",
			key: card.parameterKey,
			value: 80,
			runtimePackage: "makeup",
			hostPackage,
			packages: [hostPackage, cardPackage],
			packageBindings: [hostBinding, cardBinding],
			parameters,
		},
	];
}

if (import.meta.main) {
	if (process.argv.length !== 3 && process.argv.length !== 4) {
		throw new Error(
			"Usage: bun face_feature_campaign_catalog.ts ABSOLUTE_RUNTIME [ABSOLUTE_EFFECT_CACHE_ROOT]"
		);
	}
	console.log(
		JSON.stringify(
			featureCatalog({
				runtime: process.argv[2],
				effectCacheRoot: process.argv[3],
			})
		)
	);
}
