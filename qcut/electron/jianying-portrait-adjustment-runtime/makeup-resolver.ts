import { constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jianyingFilterPrivateRuntimeCurrent } from "../jianying-filter-local-runtime/private-runtime.js";
import {
	JIANYING_PORTRAIT_MAKEUP_CARDS,
	type JianyingPortraitMakeupCardDefinition,
} from "./makeup-catalog.js";
import { resolveJianyingPortraitMakeupCovers } from "./makeup-covers.js";

export interface JianyingPortraitMakeupCardResolution {
	card: JianyingPortraitMakeupCardDefinition;
	packagePath: string | null;
	source: "qcut-private" | "jianying-installation" | "none";
	thumbnailDataUrl?: string;
}

function installedEffectRoot() {
	return path.join(
		os.homedir(),
		"Movies",
		"JianyingPro",
		"User Data",
		"Cache",
		"effect"
	);
}

async function isReadableCardPackage({
	card,
	directory,
}: {
	card: JianyingPortraitMakeupCardDefinition;
	directory: string;
}) {
	const payload =
		card.kind === "dynamic"
			? path.join(directory, "makeup.prefab")
			: path.join(directory, "AmazingFeature", "main.scene");
	try {
		await Promise.all([
			access(path.join(directory, "config.json"), constants.R_OK),
			access(payload, constants.R_OK),
		]);
		return true;
	} catch {
		return false;
	}
}

export async function resolveJianyingPortraitMakeupCard({
	card,
}: {
	card: JianyingPortraitMakeupCardDefinition;
}): Promise<JianyingPortraitMakeupCardResolution> {
	const relativePath = path.join(card.resourceId, card.version);
	const privateCandidate = {
		packagePath: path.join(
			jianyingFilterPrivateRuntimeCurrent(),
			"Cache",
			"effect",
			relativePath
		),
		source: "qcut-private" as const,
	};
	const installedCandidate = {
		packagePath: path.join(installedEffectRoot(), relativePath),
		source: "jianying-installation" as const,
	};
	const candidates = [
		privateCandidate,
		...(process.env.QCUT_JIANYING_DISABLE_USER_CACHE === "1"
			? []
			: [installedCandidate]),
	];
	for (const candidate of candidates) {
		if (
			!(await isReadableCardPackage({ card, directory: candidate.packagePath }))
		) {
			continue;
		}
		return {
			card,
			...candidate,
		};
	}
	return { card, packagePath: null, source: "none" };
}

export async function resolveJianyingPortraitMakeupCards({
	includeThumbnails = false,
}: {
	includeThumbnails?: boolean;
} = {}) {
	const cards = await Promise.all(
		JIANYING_PORTRAIT_MAKEUP_CARDS.map((card) =>
			resolveJianyingPortraitMakeupCard({ card })
		)
	);
	if (!includeThumbnails) return cards;
	const cache = path.join(jianyingFilterPrivateRuntimeCurrent(), "Cache");
	const databaseRoots = [
		path.join(cache, "ressdk_db"),
		...(process.env.QCUT_JIANYING_DISABLE_USER_CACHE === "1"
			? []
			: [path.join(path.dirname(installedEffectRoot()), "ressdk_db")]),
	];
	const covers = await resolveJianyingPortraitMakeupCovers({
		cards: cards
			.filter(({ packagePath }) => packagePath !== null)
			.map(({ card }) => card),
		cacheRoot: path.join(cache, "portrait-makeup-covers"),
		databaseRoots,
	});
	return cards.map((card) => ({
		...card,
		thumbnailDataUrl: covers.get(card.card.id),
	}));
}
