import { isAbsolute, join } from "node:path";
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

function packagePath({
	runtime,
	identity,
}: {
	runtime: string;
	identity: { resourceId: string; version: string };
}) {
	return join(runtime, "Cache/effect", identity.resourceId, identity.version);
}

export function featureCatalog({ runtime }: { runtime: string }) {
	if (!isAbsolute(runtime) || /[\r\n\t]/u.test(runtime)) {
		throw new Error("Absolute local runtime path required");
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
		const hostPackage = packagePath({ runtime, identity });
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
			parameters,
		};
	});
	const card = jianyingPortraitMakeupCard({ id: "lip-soft-pink" });
	if (!card || card.kind !== "dynamic") {
		throw new Error("Expected dynamic lip-soft-pink makeup card");
	}
	const hostPackage = packagePath({
		runtime,
		identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup,
	});
	const cardPackage = packagePath({ runtime, identity: card });
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
			parameters,
		},
	];
}

if (import.meta.main) {
	if (process.argv.length !== 3) {
		throw new Error(
			"Usage: bun face_feature_campaign_catalog.ts ABSOLUTE_RUNTIME"
		);
	}
	console.log(JSON.stringify(featureCatalog({ runtime: process.argv[2] })));
}
