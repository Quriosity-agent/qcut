import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "playwright";
import {
	createTestProject,
	ensureStickersTabActive,
	findAvailablePort,
	restoreEnv,
} from "./helpers/electron-helpers";
import { runQCutPipelineCli } from "./helpers/qcut-pipeline-cli";
import {
	createOriginalStickerLabFixture,
	type OriginalStickerLabFixture,
} from "./helpers/sticker-lab-desktop-fixture";
import {
	forceTerminateElectronApp,
	launchIsolatedQCut,
	readRestrictedState,
	saveCurrentProject,
	withoutTransientFileMime,
} from "./helpers/sticker-lab-lifecycle-harness";
import {
	assertRuntimeResources,
	expectRuntimeFrameAt,
	selectStickerLabCard,
} from "./helpers/sticker-lab-runtime-assertions";

async function discover({ page }: { page: Page }) {
	return page.evaluate(async () => {
		const bridge = window.electronAPI?.stickerLab;
		if (!bridge) throw new Error("Sticker Lab bridge is unavailable");
		return bridge.discoverLocalReferences({});
	});
}

async function isolateDocuments({
	electronApp,
	documentsDirectory,
}: {
	electronApp: ElectronApplication;
	documentsDirectory: string;
}) {
	return electronApp.evaluate(({ app }, directory) => {
		app.setPath("documents", directory);
		return {
			documents: app.getPath("documents"),
			userData: app.getPath("userData"),
			videos: app.getPath("videos"),
		};
	}, documentsDirectory);
}

interface VideoMetadataWindow {
	__mediaStore: {
		getState(): {
			loadProjectMedia(projectId: string): Promise<void>;
			mediaItems: { type: string; thumbnailStatus?: string }[];
		};
	};
}

async function settleAlphaVideoMetadata({
	page,
	reload,
}: {
	page: Page;
	reload: boolean;
}): Promise<void> {
	if (reload) {
		await expect
			.poll(() =>
				page.evaluate(() =>
					(window as unknown as VideoMetadataWindow).__mediaStore
						.getState()
						.mediaItems.filter((item) => item.type === "video")
						.map((item) => item.thumbnailStatus)
				)
			)
			.toEqual(["ready"]);
		const { projectId } = await readRestrictedState({ page });
		if (!projectId) throw new Error("Video metadata project ID is missing");
		// Loading stored File-only resources materializes their desktop localPath.
		await page.evaluate(async (projectId) => {
			await (window as unknown as VideoMetadataWindow).__mediaStore
				.getState()
				.loadProjectMedia(projectId);
		}, projectId);
	}
	await expect
		.poll(async () =>
			(await readRestrictedState({ page })).runtimeResources
				.filter((item) => item.type === "video")
				.map((item) => item.metadata.alpha)
		)
		.toEqual([
			{
				alphaMode: 0,
				codec: "vp9",
				hasAlpha: false,
				pixelFormat: "yuv420p",
			},
		]);
}

test.describe("Sticker Lab persisted root desktop lifecycle", () => {
	let fixture: OriginalStickerLabFixture;

	test.beforeAll(async () => {
		fixture = await createOriginalStickerLabFixture();
	});

	test.afterAll(async () => {
		if (fixture) {
			await rm(fixture.cleanupRoot, { recursive: true, force: true });
		}
	});

	for (const caseName of [
		"directGif",
		"atlas",
		"pngSequence",
		"alphaVideo",
	] as const) {
		// biome-ignore lint/correctness/noEmptyPattern: this test owns both isolated Electron launches.
		test(`${caseName}: CLI root is discovered, imported, and reopened by desktop`, async ({}, testInfo) => {
			test.setTimeout(240_000);
			const runtimeCase = fixture.cases[caseName];
			const profileDirectory = path.join(
				fixture.cleanupRoot,
				`${caseName}-profile`
			);
			const documentsDirectory = path.join(
				fixture.cleanupRoot,
				`${caseName}-documents`
			);
			const videosDirectory = path.join(
				fixture.cleanupRoot,
				`${caseName}-empty-videos`
			);
			const stateHome = path.join(fixture.cleanupRoot, `${caseName}-state`);
			const rootPath = path.join(fixture.videosDirectory, "QCut Sticker Lab");
			const configPath = path.join(profileDirectory, "sticker-lab-root.json");
			const apiPort = await findAvailablePort();
			await Promise.all(
				[profileDirectory, documentsDirectory, videosDirectory, stateHome].map(
					(directory) => mkdir(directory, { recursive: true })
				)
			);
			const overrides = {
				QCUT_API_PORT: String(apiPort),
				QCUT_API_TOKEN: randomBytes(24).toString("hex"),
				QCUT_USER_DATA_DIR: profileDirectory,
				QCUT_STICKER_LAB_ROOT: "",
				QCUT_OUTPUT_DIR: path.join(fixture.cleanupRoot, `${caseName}-output`),
				QCUT_E2E_OFFSCREEN: "1",
				XDG_STATE_HOME: stateHome,
			};
			const previousEnvironment = Object.keys(overrides).map((name) => ({
				name,
				value: process.env[name],
			}));
			Object.assign(process.env, overrides);
			let activeApp: ElectronApplication | null = null;

			try {
				const firstRun = await launchIsolatedQCut({
					apiPort,
					profileDirectory,
					videosDirectory,
				});
				activeApp = firstRun.electronApp;
				const isolatedPaths = await isolateDocuments({
					electronApp: activeApp,
					documentsDirectory,
				});
				expect(isolatedPaths).toEqual({
					documents: documentsDirectory,
					userData: profileDirectory,
					videos: videosDirectory,
				});
				const before = await discover({ page: firstRun.page });
				expect(before.rootPath).toBe(
					path.join(videosDirectory, "QCut Sticker Lab")
				);
				expect(before.summary.itemCount).toBe(0);

				const configured = await runQCutPipelineCli({
					apiPort,
					args: [
						"sticker-lab",
						"set-root",
						"--root",
						rootPath,
						"--skip-health",
					],
				});
				expect(configured.envelopes.at(-1)?.status).toBe("ok");
				expect(configured.envelopes.at(-1)?.data?.data).toMatchObject({
					rootPath,
					source: "persisted",
					configPath,
					savedRootPath: rootPath,
					catalogCount: 1,
					warningCount: 0,
				});
				expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
					version: 1,
					rootPath,
				});
				const discovery = await discover({ page: firstRun.page });
				expect(discovery.rootPath).toBe(rootPath);
				expect(discovery.summary.itemCount).toBe(4);
				expect(discovery.warnings).toEqual([]);
				const read = await firstRun.page.evaluate(
					async ({ rootPath, batchId, stickerId }) => {
						const bridge = window.electronAPI?.stickerLab;
						if (!bridge) throw new Error("Sticker Lab bridge is unavailable");
						const result = await bridge.readLocalReference({
							rootPath,
							batchId,
							stickerId,
						});
						return {
							bytes: Array.from(result.bytes),
							checksumSha256: result.checksumSha256,
						};
					},
					{
						rootPath,
						batchId: fixture.batchId,
						stickerId: runtimeCase.stickerId,
					}
				);
				expect(
					createHash("sha256").update(Buffer.from(read.bytes)).digest("hex")
				).toBe(read.checksumSha256);

				await createTestProject(
					firstRun.page,
					`Persisted root ${runtimeCase.kind} E2E`
				);
				await ensureStickersTabActive(firstRun.page);
				await selectStickerLabCard({ page: firstRun.page, runtimeCase });
				await expect
					.poll(
						async () =>
							(await readRestrictedState({ page: firstRun.page })).stickers
								.length
					)
					.toBe(1);
				const canvas = firstRun.page.locator(
					`canvas[data-sticker-runtime-kind="${runtimeCase.kind}"]:visible`
				);
				await expectRuntimeFrameAt({
					canvas,
					color: "blue",
					frameTimeSeconds: 0.75,
					page: firstRun.page,
					runtimeCase,
					timelineTimeSeconds: 0.75,
				});
				if (runtimeCase.kind === "alpha-video") {
					await settleAlphaVideoMetadata({ page: firstRun.page, reload: true });
				}
				const state = await readRestrictedState({ page: firstRun.page });
				expect(state.media).toHaveLength(1);
				expect(state.media[0]?.metadata).toMatchObject({
					source: "sticker-lab",
					batchId: fixture.batchId,
					itemId: runtimeCase.stickerId,
					referenceOnly: true,
					redistribution: "prohibited",
				});
				assertRuntimeResources({
					batchId: fixture.batchId,
					runtimeCase,
					state,
				});
				await saveCurrentProject({ page: firstRun.page });
				await firstRun.page.screenshot({
					path: testInfo.outputPath("01-imported.png"),
				});
				await forceTerminateElectronApp({ electronApp: activeApp });
				activeApp = null;

				const reopened = await launchIsolatedQCut({
					apiPort,
					profileDirectory,
					videosDirectory,
				});
				activeApp = reopened.electronApp;
				await isolateDocuments({ electronApp: activeApp, documentsDirectory });
				const reopenedDiscovery = await discover({ page: reopened.page });
				expect(reopenedDiscovery.rootPath).toBe(rootPath);
				expect(reopenedDiscovery.summary.itemCount).toBe(4);
				const root = await runQCutPipelineCli({
					apiPort,
					args: ["sticker-lab", "root", "--skip-health"],
				});
				expect(root.envelopes.at(-1)?.data?.data).toMatchObject({
					rootPath,
					source: "persisted",
					configPath,
				});
				if (!state.projectId)
					throw new Error("Persisted test project ID is missing");
				await reopened.page.evaluate((projectId) => {
					window.location.hash = `#/editor/${projectId}`;
				}, state.projectId);
				await expect(
					reopened.page.locator('[data-testid="timeline-track"]')
				).toBeVisible();
				const reopenedCanvas = reopened.page.locator(
					`canvas[data-sticker-runtime-kind="${runtimeCase.kind}"]:visible`
				);
				await expectRuntimeFrameAt({
					canvas: reopenedCanvas,
					color: "blue",
					frameTimeSeconds: 0.75,
					page: reopened.page,
					runtimeCase,
					timelineTimeSeconds: 0.75,
				});
				if (runtimeCase.kind === "alpha-video") {
					await settleAlphaVideoMetadata({
						page: reopened.page,
						reload: false,
					});
				}
				const reopenedState = await readRestrictedState({
					page: reopened.page,
				});
				expect(
					withoutTransientFileMime({ media: reopenedState.allMedia })
				).toEqual(withoutTransientFileMime({ media: state.allMedia }));
				expect(reopenedState.stickers).toEqual(state.stickers);
				await reopened.page.screenshot({
					path: testInfo.outputPath("02-reopened.png"),
				});
				await writeFile(
					testInfo.outputPath("persisted-root-evidence.json"),
					JSON.stringify(
						{
							passed: true,
							kind: runtimeCase.kind,
							configPath,
							rootPath,
							isolatedPaths,
							summary: reopenedDiscovery.summary,
							projectId: state.projectId,
							primarySha256: read.checksumSha256,
							runtimeResourceCount: state.runtimeResources.length,
							projectReopened: true,
						},
						null,
						2
					)
				);
			} finally {
				try {
					if (activeApp)
						await forceTerminateElectronApp({ electronApp: activeApp });
				} finally {
					for (const previous of previousEnvironment) restoreEnv(previous);
				}
			}
		});
	}
});
