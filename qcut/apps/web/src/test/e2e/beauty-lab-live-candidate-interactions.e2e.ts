import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { saveBeautyLabComparison } from "./helpers/beauty-lab-comparison";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const first = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const second = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH_2;
const output = path.resolve(
	process.env.QCUT_BEAUTY_LIVE_INTERACTIONS_OUTPUT ??
		"output/playwright/beauty-lab-live-candidate-interactions"
);
const RESTART = "live-static-audit-failed-restart-required";
const CANDIDATE = "新链路（单帧核验）";

interface CandidateProvenance {
	requestId: string;
	requestFingerprint: string;
	inputSha256: string;
	sourceKey: string;
}

interface ComparisonReport {
	adjustments: { makeup?: Record<string, unknown> };
	candidateProvenance: CandidateProvenance | null;
	comparisons: Array<{
		name: string;
		changedPixels: number;
		rgbMax: number;
		alphaMax: number;
	}>;
}

function comparison({
	report,
	name,
}: {
	report: ComparisonReport;
	name: string;
}) {
	const row = report.comparisons.find((entry) => entry.name === name);
	if (!row) throw new Error(`Missing ${name} comparison`);
	return row;
}

async function selectLip({
	controls,
	title,
}: {
	controls: Locator;
	title: string;
}) {
	const group = controls.getByRole("button", { name: "美妆", exact: true });
	if ((await group.getAttribute("aria-expanded")) === "false")
		await group.click();
	const makeup = controls.getByTestId("portrait-section-makeup");
	await makeup.getByRole("tab", { name: "口红", exact: true }).click();
	await makeup.getByRole("button", { name: title, exact: true }).click();
}

async function setIntensity({ lab, value }: { lab: Locator; value: number }) {
	const input = lab.getByLabel("程度数值", { exact: true });
	await input.fill(String(value));
	await input.press("Tab");
	await expect(input).toHaveValue(String(value));
}

async function importPortrait({
	lab,
	source,
}: {
	lab: Locator;
	source: string;
}) {
	await lab.getByLabel("实验室图片", { exact: true }).setInputFiles(source);
	await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
		path.basename(source)
	);
}

async function expectCleared({ lab }: { lab: Locator }) {
	await expect(
		lab.getByRole("img", { name: "原生结果", exact: true })
	).toHaveCount(0);
	await expect(
		lab.getByRole("img", { name: CANDIDATE, exact: true })
	).toHaveCount(0);
}

async function candidateStatus({ page }: { page: Page }) {
	return page.evaluate(() => window.electronAPI!.beautyLab!.inspectCandidate());
}

async function audit({
	app,
	page,
	lab,
	name,
}: {
	app: Parameters<typeof saveBeautyLabComparison>[0]["app"];
	page: Page;
	lab: Locator;
	name: string;
}): Promise<ComparisonReport> {
	await lab.getByRole("button", { name: "原生处理", exact: true }).click();
	await expect(
		lab.getByRole("img", { name: "原生结果", exact: true })
	).toBeVisible({ timeout: 60_000 });
	await lab.getByRole("button", { name: "候选处理", exact: true }).click();
	const image = lab.getByRole("img", { name: CANDIDATE, exact: true });
	await expect
		.poll(
			async () =>
				(await image.isVisible()) || (await lab.getByRole("alert").isVisible()),
			{ timeout: 360_000 }
		)
		.toBe(true);
	if (await lab.getByRole("alert").isVisible()) {
		await page.screenshot({ path: path.join(output, `${name}-failed.png`) });
		throw new Error(await lab.getByRole("alert").innerText());
	}
	const zip = await saveBeautyLabComparison({
		app,
		page,
		destination: path.join(output, `${name}.zip`),
	});
	const report = JSON.parse(
		await zip.file("comparison.json")!.async("string")
	) as ComparisonReport;
	expect(report.candidateProvenance?.requestFingerprint).toMatch(
		/^[a-f0-9]{64}$/
	);
	expect(
		comparison({ report, name: "original-candidate" }).changedPixels
	).toBeGreaterThan(100);
	expect(comparison({ report, name: "native-candidate" })).toMatchObject({
		changedPixels: 0,
		rgbMax: 0,
		alphaMax: 0,
	});
	return report;
}

test("Beauty Lab candidate card/person switches, zero restore, cancel and retry", async () => {
	test.skip(
		!first ||
			!existsSync(first) ||
			!second ||
			!existsSync(second) ||
			process.env.QCUT_BEAUTY_LAB_LIVE_CANDIDATE !== "1",
		"Requires the explicit native/ONNX audit opt-in and two single-face portraits"
	);
	test.setTimeout(1_800_000);
	if (!first || !second) throw new Error("Missing portrait inputs");
	await mkdir(output, { recursive: true });
	const app = await startElectronApp({
		userDataDirectory: await mkdtemp(
			path.join(os.tmpdir(), "qcut-live-interactions-")
		),
	});
	try {
		const page = await getMainWindow(app);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source: first,
			canvasSize: { width: 640, height: 480 },
		});
		const tracks = () =>
			page.evaluate(() =>
				JSON.stringify(
					(window as unknown as ReferenceWindow).__timelineStore.getState()
						.tracks
				)
			);
		const before = await tracks();
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		const controls = lab.getByTestId("beauty-lab-controls");
		expect(await candidateStatus({ page })).toMatchObject({ available: true });

		await importPortrait({ lab, source: first });
		await selectLip({ controls, title: "柔和粉" });
		await setIntensity({ lab, value: 80 });
		const softPink = await audit({
			app,
			page,
			lab,
			name: "01-first-soft-pink",
		});
		expect(softPink.adjustments.makeup).toEqual({
			lip: { cardId: "lip-soft-pink", intensity: 80 },
		});

		await selectLip({ controls, title: "珊瑚裸粉" });
		await expectCleared({ lab });
		const coral = await audit({ app, page, lab, name: "02-first-coral-nude" });
		expect(coral.adjustments.makeup).toEqual({
			lip: { cardId: "lip-coral-nude", intensity: 80 },
		});
		expect(coral.candidateProvenance?.inputSha256).toBe(
			softPink.candidateProvenance?.inputSha256
		);
		expect(coral.candidateProvenance?.requestFingerprint).not.toBe(
			softPink.candidateProvenance?.requestFingerprint
		);

		// Zero is not auditable as one active stage; it must clear and fail before native work.
		await setIntensity({ lab, value: 0 });
		await expectCleared({ lab });
		await lab.getByRole("button", { name: "候选处理", exact: true }).click();
		await expect(lab.getByRole("alert")).toBeVisible({ timeout: 30_000 });
		await expect(
			lab.getByRole("img", { name: CANDIDATE, exact: true })
		).toHaveCount(0);
		expect(await candidateStatus({ page })).toMatchObject({ available: true });

		await importPortrait({ lab, source: second });
		await expectCleared({ lab });
		await setIntensity({ lab, value: 80 });
		const person = await audit({
			app,
			page,
			lab,
			name: "03-second-coral-nude",
		});
		expect(person.candidateProvenance?.sourceKey).not.toBe(
			coral.candidateProvenance?.sourceKey
		);
		expect(person.candidateProvenance?.inputSha256).not.toBe(
			coral.candidateProvenance?.inputSha256
		);

		await setIntensity({ lab, value: 60 });
		await lab.getByRole("button", { name: "候选处理", exact: true }).click();
		const cancel = lab.getByRole("button", { name: "取消核验", exact: true });
		await expect(cancel).toBeVisible({ timeout: 30_000 });
		await cancel.click();
		await expect(cancel).toHaveCount(0, { timeout: 120_000 });
		await expect(lab.getByRole("alert")).toHaveCount(0);
		await expect(
			lab.getByRole("img", { name: CANDIDATE, exact: true })
		).toHaveCount(0);
		const afterCancel = await candidateStatus({ page });
		let retry: "clean-retry" | "restart-required";
		if (afterCancel.available) {
			await lab.getByRole("button", { name: "原生处理", exact: true }).click();
			await expect(
				lab.getByRole("img", { name: "原生结果", exact: true })
			).toBeVisible({ timeout: 60_000 });
			await lab.getByRole("button", { name: "候选处理", exact: true }).click();
			await expect(
				lab.getByRole("img", { name: CANDIDATE, exact: true })
			).toBeVisible({ timeout: 360_000 });
			retry = "clean-retry";
		} else {
			expect(afterCancel.blockers).toContain(RESTART);
			await expect(
				lab.getByRole("status", { name: "实验室状态" })
			).toContainText("需重启 QCut");
			retry = "restart-required";
		}

		expect(await tracks()).toBe(before);
		expect(errors).toEqual([]);
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					passed: true,
					scope: "audited-single-static-frame",
					cardSwitch: [softPink, coral].map((row) => row.candidateProvenance),
					zeroRestoreRejectedBeforeNativeWork: true,
					personSwitch: person.candidateProvenance,
					cancellation: { outcome: retry, statusAfterCancel: afterCancel },
					timelineUnchanged: true,
					pageErrors: errors,
				},
				null,
				2
			)
		);
	} finally {
		await app.close();
	}
});
