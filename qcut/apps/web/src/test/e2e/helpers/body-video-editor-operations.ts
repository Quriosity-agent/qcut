import { expect, type Page } from "@playwright/test";
import { waitForProjectLoad } from "./electron-helpers";
import type { BodyVideoWindow } from "./independent-body-video-helpers";

export interface ExportStoreWindow extends BodyVideoWindow {
	__exportStore: {
		getState: () => {
			error: string | null;
			progress: { isExporting: boolean; progress: number };
		};
	};
	router?: {
		navigate: (options: {
			to: string;
			params: Record<string, string>;
		}) => Promise<void> | void;
	};
}

export async function waitForExportIdle({ page }: { page: Page }) {
	const read = () =>
		page.evaluate(() => {
			const state = (
				window as unknown as ExportStoreWindow
			).__exportStore.getState();
			return {
				isExporting: state.progress.isExporting,
				error: state.error,
				progress: state.progress.progress,
			};
		});
	await expect
		.poll(async () => (await read()).isExporting, {
			timeout: 900_000,
			intervals: [500, 1_000],
		})
		.toBe(false);
	return read();
}

export async function openProjectInEditor({
	page,
	projectId,
}: {
	page: Page;
	projectId: string;
}) {
	await page.evaluate(async (id) => {
		const router = (window as unknown as ExportStoreWindow).router;
		if (router?.navigate) {
			await router.navigate({
				to: "/editor/$project_id",
				params: { project_id: id },
			});
			return;
		}
		window.location.hash = `#/editor/${id}`;
	}, projectId);
	await waitForProjectLoad(page);
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						(window as unknown as ExportStoreWindow).__projectStore.getState()
							.activeProject?.id ?? null
				),
			{ timeout: 60_000 }
		)
		.toBe(projectId);
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					(window as unknown as BodyVideoWindow).__timelineStore
						.getState()
						.tracks.some((track) =>
							track.elements.some((element) => element.type === "media")
						)
				),
			{ timeout: 60_000 }
		)
		.toBe(true);
}

export async function changeSlimBody({
	page,
	value,
}: {
	page: Page;
	value: number;
}) {
	await page.evaluate(() => {
		const timeline = (
			window as unknown as BodyVideoWindow
		).__timelineStore.getState();
		const track = timeline.tracks.find((item) =>
			item.elements.some((element) => element.type === "media")
		);
		const clip = track?.elements.find((element) => element.type === "media");
		if (!track || !clip)
			throw new Error("Body parameter UI needs a loaded media clip");
		timeline.setSelectedElements([{ trackId: track.id, elementId: clip.id }]);
	});
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	await page
		.getByTestId("jianying-portrait-adjustments")
		.getByRole("tab", { name: "美体", exact: true })
		.click();
	const smartBody = page
		.getByTestId("portrait-group-smart-body")
		.getByRole("button", { name: "智能美体", exact: true });
	if ((await smartBody.getAttribute("aria-expanded")) === "false")
		await smartBody.click();
	const input = page
		.getByTestId("portrait-section-body")
		.getByLabel("瘦身数值", { exact: true });
	await expect(input).toBeEnabled();
	await input.fill(String(value));
	await input.press("Tab");
	await expect(input).toHaveValue(String(value));
	await expect
		.poll(() =>
			page.evaluate(() => {
				const clip = (window as unknown as BodyVideoWindow).__timelineStore
					.getState()
					.tracks.flatMap((track) => track.elements)
					.find((element) => element.type === "media");
				return clip?.type === "media"
					? clip.portraitAdjustments?.values.body_adjust_SlimBody
					: null;
			})
		)
		.toBe(value);
}
