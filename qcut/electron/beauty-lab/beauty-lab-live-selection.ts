import { lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
	checkPath,
	pinRoot,
	type PinnedRoot,
} from "./beauty-lab-research-files.js";
import type { JianyingPortraitAdjustmentRuntimePackage } from "../jianying-portrait-adjustment-contract.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	jianyingPortraitControl,
	jianyingPortraitRuntimePackageForControl,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import {
	buildJianyingDynamicMakeupParameters,
	buildJianyingStandaloneMakeupParameters,
	JIANYING_PORTRAIT_MAKEUP_CARDS,
	jianyingPortraitMakeupCard,
} from "../jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { resolveJianyingPortraitMakeupCard } from "../jianying-portrait-adjustment-runtime/makeup-resolver.js";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver.js";
import {
	JIANYING_PORTRAIT_SKIN_TONES,
	parsePortraitSkinToneResourceId,
} from "../jianying-portrait-adjustment-runtime/skin-tone-catalog.js";

const adjustmentsSchema = z
	.object({
		enabled: z.literal(true),
		values: z.record(
			z.string().refine((key) => Boolean(jianyingPortraitControl({ key }))),
			z.number().finite()
		),
		faceTarget: z
			.object({ mode: z.literal("all") })
			.strict()
			.optional(),
		faces: z.array(z.never()).max(0).optional(),
		makeup: z
			.record(
				z
					.string()
					.refine((category) =>
						JIANYING_PORTRAIT_MAKEUP_CARDS.some(
							(card) => card.category === category
						)
					),
				z
					.object({
						cardId: z.string(),
						intensity: z.number().finite().gt(0).max(100),
					})
					.strict()
			)
			.optional(),
		manualBody: z.object({}).strict().optional(),
		manualRetouch: z
			.object({ strokes: z.array(z.never()).max(0) })
			.strict()
			.optional(),
		skinToneResourceId: z.string().nullable().optional(),
	})
	.strict();

const REQUEST_KEYS = new Set([
	"protocol",
	"requestId",
	"backendVersion",
	"width",
	"height",
	"rgba",
	"adjustments",
	"sourceKey",
	"frameNumber",
	"timestampSeconds",
	"inputSha256",
	"requestFingerprint",
]);

// Call before the product parser, which intentionally drops unknown metadata.
export function selectBeautyLabLiveRequest({ request }: { request: unknown }) {
	const raw = z
		.record(
			z
				.string()
				.refine(
					(key) => REQUEST_KEYS.has(key),
					"Unsupported live static request key or source pre-roll"
				),
			z.unknown()
		)
		.parse(request);
	const adjustments = adjustmentsSchema.parse(raw.adjustments);
	const skinToneResourceId = parsePortraitSkinToneResourceId({
		value: adjustments.skinToneResourceId,
	});
	const packages = new Set<JianyingPortraitAdjustmentRuntimePackage>();
	for (const [key, value] of Object.entries(adjustments.values)) {
		const control = jianyingPortraitControl({ key });
		if (!control || value < control.min || value > control.max) {
			throw new Error("Unsupported live static face control");
		}
		const runtimePackage = jianyingPortraitRuntimePackageForControl({
			control,
		});
		if (value === 0) continue;
		if (control.group !== "face" || runtimePackage.startsWith("manual-")) {
			throw new Error(
				"Live static candidate accepts global face controls only"
			);
		}
		packages.add(runtimePackage);
	}
	const makeup = Object.entries(adjustments.makeup ?? {});
	if (packages.size + makeup.length !== 1) {
		throw new Error(
			"Exactly one nonzero render stage is required for a static audit"
		);
	}
	if (makeup.length === 1) {
		const [category, selection] = makeup[0];
		const card = jianyingPortraitMakeupCard({ id: selection.cardId });
		if (!card || card.category !== category || skinToneResourceId) {
			throw new Error("Unsupported live static makeup card or category");
		}
		return { kind: "makeup" as const, card, intensity: selection.intensity };
	}
	const [runtimePackage] = packages;
	if (runtimePackage === "skin-tone" && skinToneResourceId === null) {
		throw new Error(
			"Explicitly disabled skin tone cannot render active skin-tone controls"
		);
	}
	if (skinToneResourceId && runtimePackage !== "skin-tone") {
		throw new Error("Skin tone identity requires the skin-tone render stage");
	}
	return {
		kind: "numeric" as const,
		runtimePackage,
		...(skinToneResourceId ? { skinToneResourceId } : {}),
		parameters: JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage,
				values: adjustments.values,
			})
		) as unknown,
	};
}

interface PackageIdentity {
	resourceId: string;
	version: string;
}

export function createBeautyLabLiveSelectionResolver({
	runtimeRoot,
	allowProductCache = false,
}: {
	runtimeRoot: PinnedRoot;
	allowProductCache?: boolean;
}) {
	let productRoot: Promise<PinnedRoot> | undefined;
	const trustedPackagePath = async ({
		resolution,
		identities,
	}: {
		resolution: {
			packagePath: string | null;
			source: "qcut-private" | "jianying-installation" | "none";
		};
		identities: readonly PackageIdentity[];
	}) => {
		if (!resolution.packagePath || resolution.source === "none") {
			throw new Error("Trusted face package unavailable");
		}
		let root = runtimeRoot;
		let prefix = "Cache/effect";
		if (resolution.source === "jianying-installation") {
			if (!allowProductCache)
				throw new Error("Product cache fallback is disabled");
			productRoot ??= (async () => {
				const home = await pinRoot({ root: os.homedir() });
				const effectRoot = await checkPath({
					root: home,
					relativePath: "Movies/JianyingPro/User Data/Cache/effect",
				});
				return pinRoot({ root: effectRoot });
			})();
			root = await productRoot;
			prefix = "";
		} else if (resolution.source !== "qcut-private") {
			throw new Error("Untrusted face package source");
		}
		// checkPath requires slash-separated relative paths on every platform.
		const relativePath = identities
			.map(({ resourceId, version }) =>
				path.posix.join(prefix, resourceId, version)
			)
			.find((candidate) =>
				[root.declared, root.canonical].some(
					(base) => path.join(base, candidate) === resolution.packagePath
				)
			);
		if (!relativePath) {
			throw new Error("Resolved package differs from pinned catalog identity");
		}
		const packagePath = await checkPath({ root, relativePath });
		if (
			(await realpath(resolution.packagePath)) !== packagePath ||
			!(await lstat(packagePath)).isDirectory()
		) {
			throw new Error("Resolved package is not a pinned catalog directory");
		}
		return packagePath;
	};
	const numericPackage = async ({
		runtimePackage,
		skinToneResourceId,
	}: {
		runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
		skinToneResourceId?: NonNullable<
			ReturnType<typeof parsePortraitSkinToneResourceId>
		>;
	}) => {
		const resolution = await resolveJianyingPortraitPackage({
			runtimePackage,
			...(skinToneResourceId ? { skinToneResourceId } : {}),
		});
		if (
			resolution.group !== "face" ||
			resolution.runtimePackage !== runtimePackage ||
			resolution.skinToneResourceId !== skinToneResourceId
		) {
			throw new Error("Resolved face package metadata differs from selection");
		}
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage];
		const tone = JIANYING_PORTRAIT_SKIN_TONES.find(
			({ resourceId }) => resourceId === skinToneResourceId
		);
		const identities = tone
			? [...(tone.resourceId === identity.resourceId ? [identity] : []), tone]
			: [identity];
		return trustedPackagePath({ resolution, identities });
	};
	return async ({
		selection,
	}: {
		selection: ReturnType<typeof selectBeautyLabLiveRequest>;
	}): Promise<{
		packagePath: string;
		parameters: unknown;
		additionalPackagePath?: string;
	}> => {
		if (selection.kind === "numeric") {
			return {
				packagePath: await numericPackage(selection),
				parameters: selection.parameters,
			};
		}
		const { card, intensity } = selection;
		const resolution = await resolveJianyingPortraitMakeupCard({ card });
		const identityKeys = [
			"id",
			"category",
			"resourceId",
			"version",
			"kind",
			"parameterKey",
		] as const;
		if (identityKeys.some((key) => resolution.card[key] !== card[key])) {
			throw new Error("Resolved makeup card differs from catalog identity");
		}
		const cardPath = await trustedPackagePath({
			resolution,
			identities: [card],
		});
		if (card.kind === "standalone") {
			return {
				packagePath: cardPath,
				parameters: JSON.parse(
					buildJianyingStandaloneMakeupParameters({
						card,
						intensity,
						targetFaceId: -1,
					})
				) as unknown,
			};
		}
		return {
			packagePath: await numericPackage({ runtimePackage: "makeup" }),
			additionalPackagePath: cardPath,
			parameters: JSON.parse(
				buildJianyingDynamicMakeupParameters({
					selections: [{ card, intensity, packagePath: cardPath }],
					targetFaceId: -1,
				})
			) as unknown,
		};
	};
}
