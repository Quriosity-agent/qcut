import path from "node:path";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import {
	armBodyPlaybackEvidence,
	finishBodyPlaybackEvidence,
} from "./body-playback-evidence";
import { readBodyPlaybackResources } from "./body-playback-resource-probe";
import {
	captureSegmentedFrame,
	waitForSegmentedFrame,
} from "./body-segmented-playback-evidence";
import { readSegmentedRequests } from "./body-segmented-playback-requests";
import { changeSlimBody } from "./body-video-editor-operations";
import type { BodyOperationFrame } from "./body-video-operation-evidence";
import { seek } from "./independent-body-video-helpers";

export async function verifySegmentedCancellation({
	app,
	page,
	output,
	userDataDirectory,
	fps,
	generation,
	reference,
	evidence,
}: {
	app: ElectronApplication;
	page: Page;
	output: string;
	userDataDirectory: string;
	fps: number;
	generation: string;
	reference: BodyOperationFrame[];
	evidence: Record<string, unknown>;
}) {
	const resources = async ({ label }: { label: string }) =>
		readBodyPlaybackResources({ app, page, userDataDirectory, label });
	await seek({ page, frame: 0, fps });
	await waitForSegmentedFrame({
		page,
		frame: 0,
		generation,
		settled: true,
	});
	const beforeCancel = (await readSegmentedRequests({ app })).length;
	await changeSlimBody({ page, value: 60 });
	await expect
		.poll(
			async () =>
				(await readSegmentedRequests({ app, after: beforeCancel })).some(
					(request) =>
						request.status === "pending" &&
						request.channel.includes("render") &&
						request.values?.body_adjust_SlimBody === 60
				),
			{ timeout: 300_000, intervals: [20] }
		)
		.toBe(true);
	evidence.pendingAtCancel = await readSegmentedRequests({
		app,
		after: beforeCancel,
	});
	await page.getByTestId("cancel-effect-playback").click();
	await armBodyPlaybackEvidence({ page, stage: "after-cancel" });
	await expect(page.getByTestId("effect-playback-status")).toHaveAttribute(
		"data-status",
		"idle"
	);
	await expect(page.getByTestId("effect-playback-canvas")).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(await readSegmentedRequests({ app, after: beforeCancel })).filter(
					(request) => request.status === "pending"
				).length,
			{ timeout: 300_000, intervals: [100, 500] }
		)
		.toBe(0);
	await page.waitForTimeout(1000);
	const afterCancelCapture = await finishBodyPlaybackEvidence({ page });
	expect(afterCancelCapture.errors).toEqual([]);
	expect(afterCancelCapture.frames).toHaveLength(0);
	const cancelRequests = await readSegmentedRequests({
		app,
		after: beforeCancel,
	});
	expect(
		cancelRequests.some(
			(request) =>
				request.channel.includes("cancel") && request.result?.cancelled === true
		)
	).toBe(true);
	await expect
		.poll(
			async () => {
				const snapshot = await resources({ label: "cancel-cleanup" });
				return snapshot.opfs.length === 0 && snapshot.bitmap?.live === 0;
			},
			{ timeout: 60_000 }
		)
		.toBe(true);
	evidence.cancellation = {
		requests: cancelRequests,
		capture: afterCancelCapture,
		resources: await resources({ label: "cancelled" }),
	};

	await changeSlimBody({ page, value: 55 });
	await page.getByTestId("prepare-effect-playback").click();
	const restored = await waitForSegmentedFrame({
		page,
		frame: 0,
		settled: true,
	});
	if (!restored.generation)
		throw new Error("Restored stream has no generation");
	evidence.restored = await captureSegmentedFrame({
		page,
		output,
		stage: "restored",
		frame: 0,
		generation: restored.generation,
		reference,
	});
	await page.screenshot({ path: path.join(output, "restored-ui.png") });
	await page.getByTestId("cancel-effect-playback").click();
	await expect
		.poll(
			async () => {
				const snapshot = await resources({ label: "final-cleanup" });
				return snapshot.opfs.length === 0 && snapshot.bitmap?.live === 0;
			},
			{ timeout: 60_000 }
		)
		.toBe(true);
	evidence.finalResources = await resources({ label: "final" });
}
