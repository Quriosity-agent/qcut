// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildJianyingFontCatalog,
	getDefaultJianyingFontSearchRoots,
	readVerifiedJianyingFontBytes,
	summarizeJianyingFontCatalog,
} from "../jianying-font-lab-catalog.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "qcut-font-lab-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe("Jianying font lab catalog", () => {
	it("searches the QCut private caches under the platform user-data directory", () => {
		const userData = join(tmpdir(), "qcut-font-lab-user-data");
		vi.stubEnv("QCUT_USER_DATA_DIR", userData);
		const roots = getDefaultJianyingFontSearchRoots();
		expect(roots.slice(0, 2)).toEqual([
			{
				path: join(userData, "PrivateAssets", "JianyingFonts"),
				sourceKind: "qcut-cache",
			},
			{
				path: join(userData, "PrivateAssets", "JianyingText", "Cache"),
				sourceKind: "qcut-cache",
			},
		]);
		// Jianying's own cache stays where the app writes it.
		expect(
			roots[2].path.endsWith(
				join("JianyingPro", "User Data", "Cache", "effect")
			)
		).toBe(true);
	});
	it("deduplicates exact font files, combines sources, and never exposes paths", async () => {
		const cache = await createTemporaryDirectory();
		const effect = join(cache, "effect");
		const artistEffect = join(cache, "artistEffect");
		await Promise.all([
			mkdir(join(effect, "one"), { recursive: true }),
			mkdir(join(artistEffect, "two"), { recursive: true }),
		]);
		await Promise.all([
			writeFile(join(effect, "one", "same.ttf"), "same-font-bytes"),
			writeFile(join(artistEffect, "two", "same.otf"), "same-font-bytes"),
			writeFile(join(effect, "one", "other.otf"), "other-font-bytes"),
			writeFile(join(effect, "one", "empty.ttf"), ""),
			writeFile(join(effect, "one", "._ignored.ttf"), "apple-double"),
		]);

		const catalog = await buildJianyingFontCatalog({
			roots: [
				{ path: effect, sourceKind: "effect" },
				{ path: artistEffect, sourceKind: "artist-effect" },
			],
			readFontMetadata: ({ bytes }) => {
				const label = bytes.toString().startsWith("same") ? "Same" : "Other";
				return {
					familyName: `${label} Family`,
					fullName: `${label} Regular`,
					postscriptName: `${label}-Regular`,
					subfamilyName: "Regular",
				};
			},
		});

		expect(catalog).toMatchObject({
			rootCount: 2,
			fileCount: 4,
			duplicateFileCount: 1,
			invalidFileCount: 1,
			oversizedFileCount: 0,
		});
		expect(catalog.entries).toHaveLength(2);
		const same = catalog.entries.find(({ familyName }) =>
			familyName.startsWith("Same")
		);
		expect(same).toMatchObject({
			fontId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			cssFamily: expect.stringMatching(/^QCutLocal_[a-f0-9]{20}$/),
			sourceKinds: ["artist-effect", "effect"],
		});

		const publicCatalog = summarizeJianyingFontCatalog({ catalog });
		expect(publicCatalog.count).toBe(2);
		expect(JSON.stringify(publicCatalog)).not.toContain(cache);
		expect(publicCatalog.fonts[0]).not.toHaveProperty("filePaths");
		expect(publicCatalog.fonts[0]).not.toHaveProperty("sha256");
	});

	it("rechecks the content hash before returning bytes", async () => {
		const cache = await createTemporaryDirectory();
		const fontPath = join(cache, "font.ttf");
		await writeFile(fontPath, "original-font");
		const catalog = await buildJianyingFontCatalog({
			roots: [{ path: cache, sourceKind: "effect" }],
			readFontMetadata: () => ({
				familyName: "Test",
				fullName: "Test Regular",
				postscriptName: "Test-Regular",
				subfamilyName: "Regular",
			}),
		});
		const entry = catalog.entries[0];
		const privateCacheRoot = join(cache, "private");
		expect(
			(
				await readVerifiedJianyingFontBytes({ entry, privateCacheRoot })
			).toString()
		).toBe("original-font");

		await writeFile(fontPath, "replacement-font");
		expect(
			(
				await readVerifiedJianyingFontBytes({ entry, privateCacheRoot })
			).toString()
		).toBe("original-font");
		const restored = await buildJianyingFontCatalog({
			roots: [{ path: privateCacheRoot, sourceKind: "qcut-cache" }],
			readFontMetadata: () => ({
				familyName: "Test",
				fullName: "Test Regular",
				postscriptName: "Test-Regular",
				subfamilyName: "Regular",
			}),
		});
		expect(restored.entries[0].fontId).toBe(entry.fontId);
		await writeFile(
			join(privateCacheRoot, `${entry.sha256}.${entry.format}`),
			"corrupt-retained-font"
		);
		await expect(
			readVerifiedJianyingFontBytes({ entry, privateCacheRoot })
		).rejects.toThrow("已经变化");
	});
});
