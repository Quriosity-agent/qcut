import { expect, type Page } from "@playwright/test";

export async function openTimelineToolbarGroup({
	page,
	group,
}: {
	page: Page;
	group: "tools" | "options";
}) {
	const trigger = page.getByTestId(`timeline-${group}-overflow`);
	if (!(await trigger.isVisible())) return;
	const content = page.getByTestId(`timeline-${group}-overflow-content`);
	if (!(await content.isVisible())) await trigger.click();
	await expect(content).toBeVisible();
}
