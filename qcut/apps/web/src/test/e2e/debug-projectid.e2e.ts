/**
 * Debug test to identify why 300+ databases are being created
 * This test will track projectId values throughout the sticker selection flow
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";

test.describe("Debug ProjectId Bug", () => {
	test("track projectId during sticker selection", async ({ page }) => {
		console.log("\n\n========================================");
		console.log("🔍 STARTING DATABASE BUG INVESTIGATION");
		console.log("========================================\n");

		// CHECKPOINT 1: Before creating project
		console.log("📍 CHECKPOINT 1: Before creating project");
		const beforeCreate = await page.evaluate(async () => {
			const dbs = await indexedDB.databases();
			return {
				total: dbs.length,
				names: dbs.map((db) => db.name).filter((n) => n),
			};
		});
		console.log(`   Databases: ${beforeCreate.total}`);
		console.log(`   Names: ${beforeCreate.names.join(", ")}\n`);

		// Create test project
		await createTestProject(page, "ProjectId Debug Test");

		// CHECKPOINT 2: After creating project
		console.log("📍 CHECKPOINT 2: After creating project");
		const afterCreate = await page.evaluate(async () => {
			const dbs = await indexedDB.databases();
			const mediaDbNames = dbs
				.map((db) => db.name)
				.filter((name) => name && name.startsWith("video-editor-media-"));
			return {
				total: dbs.length,
				mediaDbs: mediaDbNames.length,
				mediaDbSamples: mediaDbNames.slice(0, 5),
				allNames: dbs.map((db) => db.name).filter((n) => n),
			};
		});
		console.log(`   Total databases: ${afterCreate.total}`);
		console.log(`   Media databases: ${afterCreate.mediaDbs}`);
		console.log(
			`   Media DB samples: ${afterCreate.mediaDbSamples.join(", ")}`
		);
		console.log(`   All databases: ${afterCreate.allNames.join(", ")}\n`);

		// Get the project ID from the browser context
		const projectId = await page.evaluate(() => {
			// @ts-expect-error - accessing Zustand store directly
			const projectStore = (window as any).__ZUSTAND_STORES__?.projectStore;
			if (projectStore) {
				const state = projectStore.getState();
				console.log("[DEBUG TEST] Project store state:", state);
				return state.activeProject?.id;
			}

			// Alternative: try to get from URL
			const url = window.location.href;
			const match = url.match(/\/editor\/([^/]+)/);
			return match ? match[1] : null;
		});

		console.log("📍 CHECKPOINT 3: Project ID from store");
		console.log(`   Project ID: ${projectId}\n`);

		// CHECKPOINT 4: Inspect qcut-projects database contents
		console.log("📍 CHECKPOINT 4: Inspecting qcut-projects database");
		const projectsDbContents = await page.evaluate(async () => {
			try {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open("qcut-projects", 1);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});

				const transaction = db.transaction(["projects"], "readonly");
				const store = transaction.objectStore("projects");
				const allKeys = await new Promise<any[]>((resolve, reject) => {
					const req = store.getAllKeys();
					req.onsuccess = () => resolve(req.result as any[]);
					req.onerror = () => reject(req.error);
				});

				return {
					projectCount: allKeys.length,
					projectIds: allKeys,
				};
			} catch (error) {
				return {
					projectCount: -1,
					projectIds: [],
					error: String(error),
				};
			}
		});
		console.log(
			`   Projects in qcut-projects DB: ${projectsDbContents.projectCount}`
		);
		console.log(`   Project IDs: ${projectsDbContents.projectIds.join(", ")}`);
		if (projectsDbContents.error) {
			console.log(`   Error: ${projectsDbContents.error}`);
		}
		console.log("");

		// Open stickers panel (stickers tab is in the "edit" group)
		console.log("📍 CHECKPOINT 5: Opening stickers panel");
		// First switch to edit group, then Manual Edit subgroup
		await page.getByTestId("group-edit").click();
		await page.locator('button:has-text("Manual Edit")').click();
		await page.waitForTimeout(300);
		// Then click stickers tab
		await page.getByTestId("stickers-panel-tab").click();
		await expect(page.getByTestId("stickers-panel")).toBeVisible();

		// CHECKPOINT 6: After opening stickers panel
		const afterStickers = await page.evaluate(async () => {
			const dbs = await indexedDB.databases();
			const mediaDbNames = dbs
				.map((db) => db.name)
				.filter((name) => name && name.startsWith("video-editor-media-"));
			return {
				total: dbs.length,
				mediaDbs: mediaDbNames.length,
			};
		});
		console.log(`   Databases after opening stickers: ${afterStickers.total}`);
		console.log(`   Media databases: ${afterStickers.mediaDbs}\n`);

		// Wait for stickers to load
		const stickerItems = page.getByTestId("sticker-item");
		await stickerItems
			.first()
			.waitFor({ state: "attached", timeout: 5000 })
			.catch(() => {});

		const itemCount = await stickerItems.count();
		console.log("📍 CHECKPOINT 7: Sticker panel loaded");
		console.log(`   Found ${itemCount} sticker items\n`);

		// FINAL CHECKPOINT: Get final database count
		console.log("📍 CHECKPOINT 8: Final database state");
		const finalStats = await page.evaluate(async () => {
			const dbs = await indexedDB.databases();
			const mediaDbNames = dbs
				.map((db) => db.name)
				.filter((name) => name && name.startsWith("video-editor-media-"));

			// Get unique project IDs from media database names
			const projectIdsFromDbs = mediaDbNames
				.map((name) => {
					const match = name.match(/video-editor-media-(.+)/);
					return match ? match[1] : null;
				})
				.filter((id) => id);

			return {
				total: dbs.length,
				mediaDbs: mediaDbNames.length,
				uniqueProjectIds: [...new Set(projectIdsFromDbs)],
				firstFiveMediaDbs: mediaDbNames.slice(0, 5),
				lastFiveMediaDbs: mediaDbNames.slice(-5),
			};
		});

		console.log(`   Total databases: ${finalStats.total}`);
		console.log(`   Media databases: ${finalStats.mediaDbs}`);
		console.log(
			`   Unique project IDs in media DBs: ${finalStats.uniqueProjectIds.length}`
		);
		console.log("   First 5 media databases:");
		finalStats.firstFiveMediaDbs.forEach((name, i) => {
			console.log(`      ${i + 1}. ${name}`);
		});
		console.log("   Last 5 media databases:");
		finalStats.lastFiveMediaDbs.forEach((name, i) => {
			console.log(`      ${i + 1}. ${name}`);
		});

		console.log("\n========================================");
		console.log("🚨 BUG ANALYSIS SUMMARY");
		console.log("========================================");
		console.log("Expected media databases: 1");
		console.log(`Actual media databases: ${finalStats.mediaDbs}`);
		console.log(`Excess databases: ${finalStats.mediaDbs - 1}`);
		console.log(
			`Projects in qcut-projects DB: ${projectsDbContents.projectCount}`
		);
		console.log(
			`Unique project IDs in media DBs: ${finalStats.uniqueProjectIds.length}`
		);
		console.log(
			"\n💡 If unique project IDs > 1, the bug is generating multiple project IDs"
		);
		console.log(
			"   If unique project IDs == 1, the bug is creating duplicate databases for the same project"
		);
		console.log("========================================\n");
	});
});
