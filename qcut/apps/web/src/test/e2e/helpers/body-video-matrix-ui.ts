import { expect, type Page } from "@playwright/test";
import {
	BODY_VIDEO_MATRIX_CONTROLS,
	BODY_VIDEO_MATRIX_MANUAL_LABELS,
	type BodyVideoMatrixCase,
} from "./body-video-matrix-config";
import type { BodyVideoWindow } from "./independent-body-video-helpers";

export async function applyBodyVideoMatrixControls({
	page,
	entry,
}: {
	page: Page;
	entry: BodyVideoMatrixCase;
}) {
	await page.evaluate(() => {
		const timeline = (
			window as unknown as BodyVideoWindow
		).__timelineStore.getState();
		const track = timeline.tracks.find((item) =>
			item.elements.some((element) => element.type === "media")
		);
		const clip = track?.elements.find((element) => element.type === "media");
		if (!track || !clip) throw new Error("Body matrix requires one video clip");
		timeline.setSelectedElements([{ trackId: track.id, elementId: clip.id }]);
	});
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	const panel = page.getByTestId("jianying-portrait-adjustments");
	await panel.getByRole("tab", { name: "美体", exact: true }).click();
	const smart = panel
		.getByTestId("portrait-group-smart-body")
		.getByRole("button", { name: "智能美体", exact: true });
	if ((await smart.getAttribute("aria-expanded")) === "false")
		await smart.click();
	await BODY_VIDEO_MATRIX_CONTROLS.filter(
		({ key }) => entry.values[key] !== undefined
	).reduce(async (previous, { key, label }) => {
		await previous;
		const input = panel
			.getByTestId("portrait-section-body")
			.getByLabel(`${label}数值`, { exact: true });
		await expect(input).toBeEnabled();
		await input.fill(String(entry.values[key]));
		await input.press("Tab");
		await expect(input).toHaveValue(String(entry.values[key]));
	}, Promise.resolve());
	if (entry.manualTool) {
		const toggle = panel.getByRole("button", { name: "手动美体", exact: true });
		if ((await toggle.getAttribute("aria-expanded")) === "false")
			await toggle.click();
		const manual = panel.getByTestId("portrait-manual-body-controls");
		await manual
			.getByRole("button", {
				name: BODY_VIDEO_MATRIX_MANUAL_LABELS[entry.manualTool],
				exact: true,
			})
			.click();
		const input = manual.getByLabel("强度数值", { exact: true });
		const value = entry.manualBody?.[entry.manualTool]?.intensity;
		if (value === undefined)
			throw new Error("Manual matrix case lacks intensity");
		await input.fill(String(value));
		await input.press("Tab");
		await expect(input).toHaveValue(String(value));
	}
	const read = () =>
		page.evaluate(() => {
			const clip = (window as unknown as BodyVideoWindow).__timelineStore
				.getState()
				.tracks.flatMap((track) => track.elements)
				.find((element) => element.type === "media");
			return clip?.type === "media" ? clip.portraitAdjustments : null;
		});
	await expect.poll(read).toEqual({
		enabled: true,
		engine: "independent",
		bodyVideoProfile: "swing-coreml-v1",
		values: entry.values,
		...(entry.manualBody ? { manualBody: entry.manualBody } : {}),
	});
	return read();
}
