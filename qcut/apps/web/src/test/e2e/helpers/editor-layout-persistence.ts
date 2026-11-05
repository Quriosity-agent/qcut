import { expect, type Locator, type Page } from "@playwright/test";
import {
	assertLayout,
	capture,
	selectPreset,
	LAYOUT_PRESETS,
} from "./editor-layout-evidence";

async function requireBox({ locator }: { locator: Locator }) {
	const box = await locator.boundingBox();
	if (!box) throw new Error(`Expected visible bounds for ${locator}`);
	return box;
}

async function timelineTop({ page }: { page: Page }) {
	const box = await requireBox({
		locator: page.getByTestId("timeline-toolbar"),
	});
	return box.y;
}

export async function exercisePresetPersistence({
	page,
	output,
}: {
	page: Page;
	output: string;
}) {
	await page.setViewportSize({ width: 1440, height: 900 });
	await ["默认布局", "音频创作"].reduce(async (previous, label) => {
		await previous;
		await selectPreset({ page, label });
		const initial = await timelineTop({ page });
		const separator = page
			.locator('[data-separator][aria-orientation="horizontal"]')
			.first();
		const box = await requireBox({ locator: separator });
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 8 });
		await page.mouse.up();
		await expect.poll(() => timelineTop({ page })).toBeLessThan(initial - 40);
		const resized = await timelineTop({ page });
		await selectPreset({
			page,
			label: label === "默认布局" ? "音频创作" : "默认布局",
		});
		await selectPreset({ page, label });
		await expect.poll(() => timelineTop({ page })).toBeCloseTo(resized, 0);
		await page.reload();
		await expect(
			page.getByTitle("面板布局预设", { exact: true })
		).toContainText(label);
		await expect.poll(() => timelineTop({ page })).toBeCloseTo(resized, 0);
		await assertLayout({ page });
		await capture({
			page,
			output,
			name:
				label === "默认布局"
					? "custom-default-reloaded"
					: "custom-audio-reloaded",
		});
		await page.getByTitle("面板布局预设", { exact: true }).click();
		await page
			.getByRole("button", { name: `重置${label}预设`, exact: true })
			.click();
		await page.keyboard.press("Escape");
		await expect.poll(() => timelineTop({ page })).toBeCloseTo(initial, 0);
	}, Promise.resolve());
}

export async function exerciseHeaderNames({
	page,
	projectId,
	output,
}: {
	page: Page;
	projectId: string;
	output: string;
}) {
	await page.setViewportSize({ width: 1280, height: 800 });
	await (["zh", "en"] as const).reduce(async (previous, locale) => {
		await previous;
		await page.evaluate(
			({ locale }) => {
				(
					window as unknown as {
						__localeStore: {
							getState: () => {
								setLocale: (args: { locale: "zh" | "en" }) => void;
							};
						};
					}
				).__localeStore
					.getState()
					.setLocale({ locale });
			},
			{ locale }
		);
		await [
			"短片",
			"9:16 极长项目名称 / Portrait editing project with a deliberately long title",
		].reduce(async (previousName, name) => {
			await previousName;
			await page.evaluate(
				async ({ projectId, name }) => {
					await (
						window as unknown as {
							__projectStore: {
								getState: () => {
									renameProject: (id: string, name: string) => Promise<void>;
								};
							};
						}
					).__projectStore
						.getState()
						.renameProject(projectId, name);
				},
				{ projectId, name }
			);
			const labels = LAYOUT_PRESETS.map((preset) =>
				locale === "zh" ? preset.label : preset.englishLabel
			);
			await labels.reduce(async (previousPreset, label) => {
				await previousPreset;
				await selectPreset({ page, label, locale });
				await assertLayout({ page });
			}, Promise.resolve());
			await capture({
				page,
				output,
				name: `header-${locale}-${name === "短片" ? "short" : "long"}`,
			});
			await page.getByTestId("project-menu-button").click();
			await expect(page.getByRole("menu")).toBeVisible();
			await page.keyboard.press("Escape");
		}, Promise.resolve());
	}, Promise.resolve());
}
