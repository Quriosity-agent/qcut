import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import type { MediaPortraitAdjustments } from "../../../../types/timeline";

const execFileAsync = promisify(execFile);

export async function runBodyEditorCommand<T>({
	apiPort,
	args,
	timeout = 300_000,
}: {
	apiPort: number;
	args: string[];
	timeout?: number;
}): Promise<T> {
	const result = await execFileAsync(
		"bun",
		["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
		{
			cwd: path.resolve("."),
			env: { ...process.env, QCUT_API_PORT: String(apiPort) },
			timeout,
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
		}
	);
	return JSON.parse(
		result.stdout.slice(result.stdout.trimEnd().lastIndexOf("\n{") + 1)
	) as T;
}

export async function readBodyPortraitAdjustments({
	page,
	elementId,
}: {
	page: Page;
	elementId: string;
}) {
	return page.evaluate((id) => {
		const timeline = (
			window as unknown as {
				__timelineStore: {
					getState: () => {
						tracks: Array<{
							elements: Array<{
								id: string;
								portraitAdjustments?: MediaPortraitAdjustments;
							}>;
						}>;
					};
				};
			}
		).__timelineStore.getState();
		return timeline.tracks
			.flatMap((track) => track.elements)
			.find((element) => element.id === id)?.portraitAdjustments;
	}, elementId);
}
