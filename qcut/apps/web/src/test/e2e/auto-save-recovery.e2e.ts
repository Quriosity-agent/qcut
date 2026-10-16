/**
 * Auto-save gate: an edit is saved without a manual save, and it is still
 * there after reopening the project and after restarting the app on the same
 * profile (what a user sees after a crash).
 */

import type { Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import {
	createTestProject,
	expect,
	getMainWindow,
	navigateToProjects,
	startElectronApp,
	test,
	waitForProjectLoad,
} from "./helpers/electron-helpers";

const EDIT_TEXT = "Auto-save keeps this line";

interface HarnessWindow {
	__timelineStore: {
		getState: () => {
			addTextAtTime: (
				item: { content: string; name: string },
				time: number
			) => boolean;
			tracks: Array<{ elements: Array<{ type: string; content?: string }> }>;
		};
	};
}

function projectIdFromPage({ page }: { page: Page }): string {
	const projectId = new URL(page.url()).hash.match(/^#\/editor\/([^/?]+)/)?.[1];
	if (!projectId) throw new Error("Could not resolve the E2E project id");
	return decodeURIComponent(projectId);
}

async function addEdit({ page }: { page: Page }): Promise<void> {
	const added = await page.evaluate(
		(content) =>
			(window as unknown as HarnessWindow).__timelineStore
				.getState()
				.addTextAtTime({ content, name: "Auto-save edit" }, 0),
		EDIT_TEXT
	);
	expect(added).toBe(true);
}

async function timelineHasEdit({ page }: { page: Page }): Promise<boolean> {
	return page.evaluate(
		(content) =>
			(window as unknown as HarnessWindow).__timelineStore
				.getState()
				.tracks.some((track) =>
					track.elements.some(
						(element) => element.type === "text" && element.content === content
					)
				),
		EDIT_TEXT
	);
}

async function waitForAutoSave({ page }: { page: Page }): Promise<void> {
	await expect(page.getByTestId("auto-save-indicator")).toHaveText(
		"已自动保存",
		{ timeout: 30_000 }
	);
}

async function openProject({
	page,
	projectId,
}: {
	page: Page;
	projectId: string;
}): Promise<void> {
	await page.evaluate((id) => {
		window.location.hash = `#/editor/${encodeURIComponent(id)}`;
	}, projectId);
	await waitForProjectLoad(page);
}

/** Same first-run preparation the page fixture does, for a self-launched app. */
async function openProjectsPage({
	app,
}: {
	app: ElectronApplication;
}): Promise<Page> {
	const page = await getMainWindow(app);
	await page.evaluate(() => {
		localStorage.setItem("hasSeenOnboarding", "true");
	});
	await navigateToProjects(page);
	return page;
}

test.describe("Auto-save and recovery", () => {
	test("auto-saves an edit and restores it when the project is reopened", async ({
		page,
	}) => {
		await createTestProject(page, "Auto-save reopen");
		const projectId = projectIdFromPage({ page });
		await addEdit({ page });
		await waitForAutoSave({ page });

		await navigateToProjects(page);
		await openProject({ page, projectId });
		await expect.poll(() => timelineHasEdit({ page })).toBe(true);
	});

	test("restores an auto-saved edit after the app restarts", async () => {
		test.setTimeout(180_000);
		// Both launches use this test's own profile (see appIsolation).
		const firstRun = await startElectronApp();
		let projectId: string;
		try {
			const page = await openProjectsPage({ app: firstRun });
			await createTestProject(page, "Auto-save restart");
			projectId = projectIdFromPage({ page });
			await addEdit({ page });
			await waitForAutoSave({ page });
		} finally {
			await firstRun.close();
		}

		const secondRun = await startElectronApp();
		try {
			const page = await openProjectsPage({ app: secondRun });
			await openProject({ page, projectId });
			await expect.poll(() => timelineHasEdit({ page })).toBe(true);
		} finally {
			await secondRun.close();
		}
	});
});
