import { stat } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

export async function waitForBodyExportFile({
	page,
	file,
	timeout,
}: {
	page: Page;
	file: string;
	timeout: number;
}) {
	let failure: string | null = null;
	await expect
		.poll(
			async () => {
				if (page.isClosed()) {
					failure = "Editor page closed before export completed";
					return true;
				}
				failure = await page.evaluate(() => {
					const target = window as unknown as {
						__exportStore?: {
							getState: () => { error: string | null };
						};
					};
					return target.__exportStore?.getState().error ?? null;
				});
				if (failure) return true;
				const bytes = await stat(file).then(
					(result) => result.size,
					() => 0
				);
				return bytes > 1_000;
			},
			{ timeout, intervals: [500, 1_000, 2_000] }
		)
		.toBe(true);
	// Throw after polling: expect.poll retries exceptions from its callback.
	if (failure) throw new Error(`Body export failed: ${failure}`);
}
