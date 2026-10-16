/**
 * Regression gate for a bug where using the sticker panel created hundreds of
 * `video-editor-media-*` IndexedDB databases. Adding stickers must keep one
 * media database, owned by the open project.
 */

import type { Page } from "@playwright/test";
import {
	createTestProject,
	ensureStickersTabActive,
	expect,
	test,
} from "./helpers/electron-helpers";

const MEDIA_DATABASE_PREFIX = "video-editor-media-";

async function mediaDatabaseProjectIds({
	page,
}: {
	page: Page;
}): Promise<string[]> {
	return page.evaluate(async (prefix) => {
		const databases = await indexedDB.databases();
		return databases
			.map((database) => database.name ?? "")
			.filter((name) => name.startsWith(prefix))
			.map((name) => name.slice(prefix.length));
	}, MEDIA_DATABASE_PREFIX);
}

test.describe("Sticker media storage", () => {
	test("adding stickers keeps one media database for the project", async ({
		page,
	}) => {
		await createTestProject(page, "Sticker media database");
		const projectId = decodeURIComponent(
			new URL(page.url()).hash.match(/^#\/editor\/([^/?]+)/)?.[1] ?? ""
		);
		expect(projectId).not.toBe("");

		await ensureStickersTabActive(page);
		const stickers = page
			.getByTestId("stickers-panel")
			.getByTestId("sticker-item");
		await expect(stickers.first()).toBeVisible();
		// Each click goes through the sticker selection flow that used to spawn
		// databases; stickers landing on an occupied spot are rejected, which is
		// fine here.
		for (let index = 0; index < 3; index++) {
			await stickers.nth(index).click();
		}
		await expect(
			page
				.locator('[data-sticker-id][data-sticker-render-mode="visual"]')
				.first()
		).toBeVisible();

		await expect
			.poll(() => mediaDatabaseProjectIds({ page }))
			.toEqual([projectId]);
	});
});
