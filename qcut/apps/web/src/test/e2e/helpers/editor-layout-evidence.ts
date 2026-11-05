import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const LAYOUT_PRESETS = [
	{ key: "default", label: "默认布局", englishLabel: "Default" },
	{ key: "audio", label: "音频创作", englishLabel: "Audio creation" },
	{
		key: "vertical-preview",
		label: "竖屏创作（右）",
		englishLabel: "Vertical preview (right)",
	},
	{
		key: "vertical-preview-left",
		label: "竖屏创作（左）",
		englishLabel: "Vertical preview (left)",
	},
	{ key: "inspector", label: "属性调节优先", englishLabel: "Inspector" },
	{ key: "media", label: "媒体素材优先", englishLabel: "Media" },
];

export async function assertLayout({ page }: { page: Page }) {
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const failures: string[] = [];
					for (const selector of [
						'[data-testid="timeline-toolbar"]',
						'[data-testid="preview-toolbar"]',
						"header",
					]) {
						const toolbar = document.querySelector(selector);
						if (!toolbar) {
							failures.push(`Missing ${selector}`);
							continue;
						}
						if (toolbar.scrollWidth > toolbar.clientWidth + 1)
							failures.push(`Overflow ${selector}`);
						for (const button of toolbar.querySelectorAll<HTMLButtonElement>(
							"button:not(:disabled)"
						)) {
							const rect = button.getBoundingClientRect();
							if (!rect.width || !rect.height) continue;
							if (
								!button.contains(
									document.elementFromPoint(
										rect.x + rect.width / 2,
										rect.y + rect.height / 2
									)
								)
							) {
								failures.push(
									button.dataset.testid ??
										button.title ??
										button.textContent ??
										selector
								);
							}
						}
					}
					const sections = [...document.querySelectorAll("header > div")].map(
						(element) => element.getBoundingClientRect()
					);
					if (sections.length !== 3) failures.push("Missing header sections");
					if (
						sections[0]?.right > sections[1]?.left ||
						sections[1]?.right > sections[2]?.left
					)
						failures.push("Header sections overlap");
					const project = document
						.querySelector('[data-testid="project-menu-button"]')
						?.getBoundingClientRect();
					if (
						!project ||
						project.right > sections[0].right + 1 ||
						project.width < 40
					)
						failures.push("Project menu overflow");
					return failures;
				}),
			{
				message:
					"All toolbar controls hit their visible buttons and header sections do not overlap",
			}
		)
		.toEqual([]);
	await expect
		.poll(async () => {
			const canvas = await page.getByTestId("preview-canvas").boundingBox();
			return canvas ? Math.abs(canvas.width / canvas.height - 9 / 16) : 1;
		})
		.toBeLessThan(0.005);
}

async function assertPopoverButtons({
	page,
	testId,
}: {
	page: Page;
	testId: string;
}) {
	await expect
		.poll(() =>
			page
				.getByTestId(testId)
				.locator("button:not(:disabled)")
				.evaluateAll((buttons) =>
					buttons
						.filter((button) => {
							const rect = button.getBoundingClientRect();
							return (
								rect.width > 0 &&
								rect.height > 0 &&
								!button.contains(
									document.elementFromPoint(
										rect.x + rect.width / 2,
										rect.y + rect.height / 2
									)
								)
							);
						})
						.map(
							(button) =>
								button.getAttribute("data-testid") ??
								button.getAttribute("aria-label")
						)
				)
		)
		.toEqual([]);
}

export async function exerciseToolbar({ page }: { page: Page }) {
	const zoom = page.locator("[data-zoom-level]");
	const initialZoom = Number(await zoom.getAttribute("data-zoom-level"));
	await page.getByTestId("zoom-in-button").click();
	await expect
		.poll(async () => Number(await zoom.getAttribute("data-zoom-level")))
		.toBeGreaterThan(initialZoom);
	await page.getByTestId("zoom-out-button").click();
	await expect
		.poll(async () => Number(await zoom.getAttribute("data-zoom-level")))
		.toBeCloseTo(initialZoom, 4);
	const options = page.getByTestId("timeline-options-overflow");
	const compact = await options.isVisible();
	if (compact) {
		await options.click();
		await assertPopoverButtons({
			page,
			testId: "timeline-options-overflow-content",
		});
	}
	const snapping = page.getByTestId("timeline-snapping-button");
	const wasEnabled = await snapping.getAttribute("aria-pressed");
	await snapping.click();
	await expect(snapping).toHaveAttribute(
		"aria-pressed",
		wasEnabled === "true" ? "false" : "true"
	);
	await snapping.click();
	await expect(snapping).toHaveAttribute("aria-pressed", wasEnabled!);
	if (compact) {
		await page.mouse.move(0, 0);
		await page.getByTestId("timeline-options-overflow-content").focus();
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(options).toBeFocused();
		const tools = page.getByTestId("timeline-tools-overflow");
		await tools.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByTestId("timeline-tools-overflow-content")
		).toBeVisible();
		await assertPopoverButtons({
			page,
			testId: "timeline-tools-overflow-content",
		});
		await page.getByTestId("add-track-button").click();
		await expect(page.getByRole("menu")).toBeVisible();
		await page.keyboard.press("Escape");
		const compactTracks = page.getByTestId("compact-tracks-button");
		const wasCompact = await compactTracks.getAttribute("aria-pressed");
		await compactTracks.click();
		await expect(compactTracks).toHaveAttribute(
			"aria-pressed",
			wasCompact === "true" ? "false" : "true"
		);
		await compactTracks.click();
		await expect(compactTracks).toHaveAttribute("aria-pressed", wasCompact!);
		await page.mouse.move(0, 0);
		await page.getByTestId("timeline-tools-overflow-content").focus();
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(tools).toBeFocused();
	}
	await page.getByTestId("preview-fullscreen-button").click();
	await expect(page.getByTestId("fullscreen-preview")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("fullscreen-preview")).toHaveCount(0);
	await assertLayout({ page });
}

export async function selectPreset({
	page,
	label,
	locale = "zh",
}: {
	page: Page;
	label: string;
	locale?: "zh" | "en";
}) {
	const title = locale === "zh" ? "面板布局预设" : "Panel presets";
	await expect(page.getByRole("menu")).toHaveCount(0);
	await page.getByTitle(title, { exact: true }).click();
	await page
		.getByRole("menuitem")
		.filter({ has: page.getByText(label, { exact: true }) })
		.click();
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(page.getByTitle(title, { exact: true })).toContainText(label);
	await page
		.getByTestId("preview-capture-surface")
		.waitFor({ state: "visible" });
	if (label !== "音频创作" && label !== "Audio creation")
		await page.getByTestId("media-panel-tab").click();
}
export async function capture({
	page,
	name,
	output,
}: {
	page: Page;
	name: string;
	output: string;
}) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		);
	});
	await page.waitForTimeout(350);
	const measurement = await page.evaluate(() => {
		const rect = ({ element }: { element: Element | null }) => {
			if (!element) return null;
			const r = element.getBoundingClientRect();
			return {
				x: r.x,
				y: r.y,
				width: r.width,
				height: r.height,
				right: r.right,
				bottom: r.bottom,
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
			};
		};
		const box = ({ id }: { id: string }) =>
			rect({ element: document.querySelector(`[data-testid="${id}"]`) });
		return {
			viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
			state: JSON.parse(localStorage.getItem("panel-sizes") ?? "null"),
			headerChildren: [...document.querySelectorAll("header > div")].map(
				(element) => rect({ element })
			),
			headerName: rect({ element: document.querySelector("header button") }),
			preview: box({ id: "preview-panel" }),
			canvas: box({ id: "preview-canvas" }),
			capture: box({ id: "preview-capture-surface" }),
			media: box({ id: "media-panel" }),
			timeline: box({ id: "timeline-toolbar" }),
			separators: [...document.querySelectorAll('[role="separator"]')].map(
				(element) => ({
					orientation: element.getAttribute("aria-orientation"),
					rect: rect({ element }),
				})
			),
			overflowingButtons: [...document.querySelectorAll("button")]
				.filter((element) => {
					const r = element.getBoundingClientRect();
					if (r.width === 0 || r.height === 0) return false;
					let parent = element.parentElement;
					while (parent) {
						const style = getComputedStyle(parent);
						const pr = parent.getBoundingClientRect();
						if (
							["hidden", "clip", "auto", "scroll"].includes(style.overflowX) &&
							(r.left < pr.left - 1 || r.right > pr.right + 1)
						)
							return true;
						parent = parent.parentElement;
					}
					return false;
				})
				.map((element) => ({
					label:
						element.getAttribute("title") ??
						element.getAttribute("aria-label") ??
						element.textContent,
					testid: element.getAttribute("data-testid"),
					disabled: element.disabled,
					section: element.closest('[data-testid="timeline-toolbar"]')
						? "timeline"
						: element.closest('[data-testid="preview-panel"]')
							? "preview"
							: element.closest('[data-testid="media-panel"]')
								? "media"
								: "other",
					hitTest: (() => {
						const r = element.getBoundingClientRect();
						return element.contains(
							document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
						);
					})(),
					rect: rect({ element }),
				})),
		};
	});
	await page.screenshot({
		path: path.join(output, `${name}.png`),
		animations: "disabled",
	});
	writeFileSync(
		path.join(output, `${name}.json`),
		JSON.stringify(measurement, null, 2)
	);
	console.log(
		`LAYOUT_CAPTURE ${name} ${JSON.stringify(measurement.viewport)} ${JSON.stringify(measurement.canvas)}`
	);
	return { name, ...measurement };
}
