import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import {
	createTestProject,
	navigateToProjects,
	test,
	uploadTestMedia,
} from "./helpers/electron-helpers";
import type { ReferenceWindow } from "./helpers/portrait-reference";

const fixtureRoot = process.env.QCUT_BODY_PHOTO_TEST_FIXTURE;
const runtimeRoot =
	process.env.QCUT_BODY_PHOTO_TEST_RUNTIME ??
	process.env.QCUT_BODY_PHOTO_RUNTIME;
const output = path.resolve(
	process.env.QCUT_BODY_PHOTO_TEST_OUTPUT ?? "output/playwright/body-photo-lab"
);

async function expectHostStopped({ origin }: { origin: string }) {
	await expect
		.poll(
			async () => {
				try {
					await fetch(`${origin}/api/catalog`, {
						signal: AbortSignal.timeout(1000),
					});
					return false;
				} catch {
					return true;
				}
			},
			{ timeout: 15_000 }
		)
		.toBe(true);
}

async function setLift({ page, value }: { page: Page; value: number }) {
	const input = page.locator("#number-ButtLift");
	const group = input.locator("xpath=ancestor::details");
	if ((await group.getAttribute("open")) === null)
		await group.locator("summary").click();
	await input.fill(String(value));
	await input.press("Tab");
}

async function importPhoto({ page, source }: { page: Page; source: string }) {
	await page.locator("#photo-file").setInputFiles(source);
	await expect(page.locator("#source-image")).toHaveAttribute(
		"src",
		/^\/api\/photos\//,
		{ timeout: 120_000 }
	);
	await expect(page.locator("#apply")).toBeEnabled({ timeout: 120_000 });
}

test("Beauty Lab launches the verified CPU photo editor, preserves PNG pixels and recovers its owned window", async ({
	page,
	electronApp,
}) => {
	test.skip(
		!fixtureRoot ||
			!existsSync(path.join(fixtureRoot, "ui-cases.json")) ||
			!runtimeRoot ||
			!existsSync(runtimeRoot),
		"Requires the private V3 UI photo fixture and an installed local CPU runtime"
	);
	test.setTimeout(300_000);
	if (!fixtureRoot || !runtimeRoot)
		throw new Error("Missing private fixture or runtime");
	const fixture = JSON.parse(
		await readFile(path.join(fixtureRoot, "ui-cases.json"), "utf8")
	) as {
		photos: { automatic: { file: string; sha256: string } };
		expectedPngSha256: { "auto-lift": string };
	};
	const source = path.resolve(fixtureRoot, fixture.photos.automatic.file);
	expect(source.startsWith(path.resolve(fixtureRoot) + path.sep)).toBe(true);
	expect(
		createHash("sha256")
			.update(await readFile(source))
			.digest("hex")
	).toBe(fixture.photos.automatic.sha256);
	await mkdir(output, { recursive: true });
	await electronApp.evaluate(({ dialog }) => {
		Reflect.deleteProperty(process.env, "QCUT_BODY_PHOTO_RUNTIME");
		Reflect.deleteProperty(process.env, "QCUT_BODY_PHOTO_PYTHON");
		dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
	});
	await navigateToProjects(page);
	await createTestProject(page, `CPU Body Photo ${Date.now()}`);
	await uploadTestMedia(page, source);
	await page.evaluate(() => {
		const stores = window as unknown as ReferenceWindow;
		const media = stores.__mediaStore.getState().mediaItems[0];
		const timeline = stores.__timelineStore.getState();
		const track = timeline.tracks.find(
			(candidate) => candidate.isMain || candidate.type === "media"
		);
		if (!media || !track) throw new Error("Missing photo or timeline");
		const elementId = timeline.addElementToTrack(track.id, {
			type: "media",
			mediaId: media.id,
			name: media.name,
			duration: 1,
			startTime: 0,
			trimStart: 0,
			trimEnd: 0,
		});
		if (!elementId) throw new Error("Cannot select photo");
		timeline.setSelectedElements([{ trackId: track.id, elementId }]);
	});
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	const snapshot = () =>
		page.evaluate(() =>
			JSON.stringify(
				(window as unknown as ReferenceWindow).__timelineStore.getState().tracks
			)
		);
	const before = await snapshot();
	await page.getByTestId("beauty-lab-open").click();
	const launcher = page.getByTestId("beauty-lab-body-photo");
	const open = launcher.getByRole("button", { name: "打开照片美体" });
	const chooseRuntime = launcher.getByRole("button", { name: "选择本地资源" });
	const close = launcher.getByRole("button", { name: "关闭照片窗口" });
	await expect(chooseRuntime).toBeEnabled();
	await expect(open).toBeDisabled();
	expect(
		(await page.evaluate(() => window.electronAPI!.bodyPhotoLab!.inspect()))
			.available
	).toBe(false);
	const windowCount = electronApp.windows().length;
	await chooseRuntime.click();
	await expect(chooseRuntime).toBeEnabled();
	await expect(open).toBeDisabled();
	expect(electronApp.windows()).toHaveLength(windowCount);
	await electronApp.evaluate(({ dialog }, selection) => {
		dialog.showOpenDialog = async () => ({
			canceled: false,
			filePaths: [selection],
		});
	}, runtimeRoot);
	await chooseRuntime.click();
	await expect(open).toBeEnabled({ timeout: 60_000 });
	const readiness = await page.evaluate(() =>
		window.electronAPI!.bodyPhotoLab!.inspect()
	);
	expect(readiness.available, readiness.message).toBe(true);
	await expect(open).toBeEnabled({ timeout: 60_000 });
	await page.screenshot({
		path: path.join(output, "qcut-launcher.png"),
		animations: "disabled",
	});
	const opening = electronApp.waitForEvent("window");
	await open.click();
	const photo = await opening;
	await photo.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
	const origin = new URL(photo.url()).origin;
	await expect(photo.locator('input[type="range"][id^="range-"]')).toHaveCount(
		21
	);
	expect(
		await photo.evaluate(() => ({
			node: typeof Reflect.get(window, "require"),
			api: typeof Reflect.get(window, "electronAPI"),
		}))
	).toEqual({ node: "undefined", api: "undefined" });
	await importPhoto({ page: photo, source });
	await setLift({ page: photo, value: 100 });
	await photo.locator("#background-protection").check();
	const rendered = photo.waitForResponse(
		(reply) =>
			reply.url() === `${origin}/api/render` &&
			reply.request().method() === "POST",
		{ timeout: 120_000 }
	);
	await photo.locator("#apply").click();
	const response = await rendered;
	expect(response.status()).toBe(200);
	const report = (await response.json()) as {
		status: string;
		result: { url: string; pngSha256: string };
	};
	expect(report.status).toBe("applied");
	expect(report.result.pngSha256).toBe(fixture.expectedPngSha256["auto-lift"]);
	await expect(photo.locator("#download")).toBeVisible();
	await expect(photo.locator("#result-image")).toHaveAttribute(
		"src",
		report.result.url
	);
	const png = await (
		await photo.request.get(`${origin}${report.result.url}`)
	).body();
	expect(createHash("sha256").update(png).digest("hex")).toBe(
		report.result.pngSha256
	);
	const destination = path.join(output, "electron-auto-lift.png");
	await electronApp.evaluate(
		({ BrowserWindow }, { origin, destination }) => {
			const window = BrowserWindow.getAllWindows().find((candidate) =>
				candidate.webContents.getURL().startsWith(origin)
			);
			if (!window) throw new Error("Missing download window");
			window.webContents.session.once("will-download", (_event, item) =>
				item.setSavePath(destination)
			);
		},
		{ origin, destination }
	);
	await photo.locator("#download").click();
	await expect
		.poll(
			async () => {
				const saved = await readFile(destination).catch(() => null);
				return saved ? createHash("sha256").update(saved).digest("hex") : null;
			},
			{ timeout: 30_000 }
		)
		.toBe(report.result.pngSha256);
	expect(await readFile(destination)).toEqual(png);
	await photo.screenshot({
		path: path.join(output, "qcut-photo-auto-lift.png"),
		animations: "disabled",
	});
	await setLift({ page: photo, value: 50 });
	await expect(photo.locator("#download")).toBeHidden();
	await photo.evaluate(() => {
		const originalFetch = window.fetch.bind(window);
		const responseHeld = new Promise<void>((resolve) => {
			Reflect.set(window, "__releaseBodyPhotoRender", resolve);
		});
		window.fetch = async (input, options) => {
			const response = await originalFetch(input, options);
			if (input === "/api/render") {
				window.fetch = originalFetch;
				await responseHeld;
			}
			return response;
		};
	});
	const staleResponse = photo.waitForResponse(`${origin}/api/render`);
	await photo.locator("#apply").click();
	await expect(photo.locator("#processing-overlay")).toBeVisible();
	await setLift({ page: photo, value: 75 });
	await photo.evaluate(() => {
		Reflect.get(window, "__releaseBodyPhotoRender")();
		Reflect.deleteProperty(window, "__releaseBodyPhotoRender");
	});
	expect((await staleResponse).status()).toBe(200);
	await expect(photo.locator("#processing-overlay")).toBeHidden();
	await expect(photo.locator("#download")).toBeHidden();
	await expect(photo.locator("#result-layer")).toBeHidden();
	await expect(photo.locator("#view-result")).toBeDisabled();
	const requestStarted = photo.waitForRequest(
		(request) =>
			request.url() === `${origin}/api/render` && request.method() === "POST"
	);
	await photo.locator("#apply").click();
	await requestStarted;
	await close.click();
	await expect.poll(() => photo.isClosed()).toBe(true);
	await expectHostStopped({ origin });
	await expect(close).toBeHidden();
	await expect(open).toBeEnabled();

	const reopening = electronApp.waitForEvent("window");
	await open.click();
	const recovered = await reopening;
	await recovered.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
	const recoveredOrigin = new URL(recovered.url()).origin;
	await importPhoto({ page: recovered, source });
	await electronApp.evaluate(({ BrowserWindow }, url) => {
		const window = BrowserWindow.getAllWindows().find((candidate) =>
			candidate.webContents.getURL().startsWith(url)
		);
		if (!window) throw new Error("Missing owned photo window");
		window.webContents.forcefullyCrashRenderer();
	}, recoveredOrigin);
	await expect.poll(() => recovered.isClosed()).toBe(true);
	await expectHostStopped({ origin: recoveredOrigin });
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(close).toBeHidden();
	await expect(open).toBeEnabled();
	const finalOpening = electronApp.waitForEvent("window");
	await open.click();
	const finalPhoto = await finalOpening;
	await finalPhoto.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
	await importPhoto({ page: finalPhoto, source });
	const identityResponse = finalPhoto.waitForResponse(
		(reply) =>
			reply.url().endsWith("/api/render") && reply.request().method() === "POST"
	);
	await finalPhoto.locator("#apply").click();
	expect((await (await identityResponse).json()).status).toBe("identity");
	await close.click();
	expect(await snapshot()).toBe(before);
});
