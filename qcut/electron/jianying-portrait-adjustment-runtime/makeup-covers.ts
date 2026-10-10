import { readJianyingCachedImage } from "../jianying-shared/jianying-image-cache.js";
import { resolveJianyingResourceCoverUrls } from "../jianying-text/jianying-text-style-cover-metadata.js";
import type { JianyingPortraitMakeupCardDefinition } from "./makeup-catalog.js";

async function readCover({
	card,
	cacheRoot,
	fetcher,
	sourceUrl,
}: {
	card: JianyingPortraitMakeupCardDefinition;
	cacheRoot: string;
	fetcher: typeof fetch;
	sourceUrl?: string;
}) {
	try {
		const image = await readJianyingCachedImage({
			cacheRoot,
			fetcher,
			label: "剪映美妆封面",
			maximumBytes: 768 * 1024,
			timeoutMs: 10_000,
			source: {
				cacheKey: `makeup-cover-v1:${card.resourceId}/${card.version}`,
				sourceUrl,
			},
		});
		return `data:${image.mimeType};base64,${image.bytes.toString("base64")}`;
	} catch {
		return undefined;
	}
}

export async function resolveJianyingPortraitMakeupCovers({
	cards,
	cacheRoot,
	databaseRoots,
	fetcher = fetch,
}: {
	cards: readonly JianyingPortraitMakeupCardDefinition[];
	cacheRoot: string;
	databaseRoots: string[];
	fetcher?: typeof fetch;
}): Promise<Map<string, string>> {
	if (cards.length === 0) return new Map();
	const cached = await Promise.all(
		cards.map(async (card) => ({
			card,
			dataUrl: await readCover({ card, cacheRoot, fetcher }),
		}))
	);
	const missingCards = cached
		.filter(({ dataUrl }) => !dataUrl)
		.map(({ card }) => card);
	const result = new Map(
		cached.flatMap(({ card, dataUrl }) =>
			dataUrl ? [[card.id, dataUrl] as const] : []
		)
	);
	if (missingCards.length === 0) return result;
	const references = missingCards.map(({ resourceId, version }) => ({
		resourceId,
		version,
	}));
	const catalogs = await Promise.all(
		databaseRoots.map((databaseRoot) =>
			resolveJianyingResourceCoverUrls({ databaseRoot, references }).catch(
				() => new Map<string, string>()
			)
		)
	);
	const covers = await Promise.all(
		missingCards.map(async (card) => {
			const identity = `${card.resourceId}/${card.version}`;
			const sourceUrls = [
				...new Set(
					catalogs.flatMap((catalog) => {
						const url = catalog.get(identity);
						return url ? [url] : [];
					})
				),
			];
			const dataUrl = await sourceUrls.reduce<Promise<string | undefined>>(
				async (previous, sourceUrl) => {
					const loaded = await previous;
					return loaded ?? readCover({ card, cacheRoot, fetcher, sourceUrl });
				},
				Promise.resolve(undefined)
			);
			return dataUrl ? ([card.id, dataUrl] as const) : undefined;
		})
	);
	return new Map([...result, ...covers.filter((cover) => cover !== undefined)]);
}
