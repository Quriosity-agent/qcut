import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	saveBeautyLabComparison as saveComparison,
	verifyBeautyLabDifferencePNG as verifyDifferencePNG,
} from "./helpers/beauty-lab-comparison";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_BEAUTY_INDEPENDENT_OUTPUT ??
		"output/playwright/beauty-lab-independent"
);
const INDEPENDENT = "自研结果";

interface ComparisonReport {
	mode: string;
	width: number;
	height: number;
	adjustments: {
		values: Record<string, number>;
		makeup?: Record<string, { cardId: string; intensity: number }>;
	};
	independentResultPresent?: boolean;
	independentProvenance?: {
		provider: string;
		report: { outputPngSha256: string };
	};
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

async function timelineSnapshot({ page }: { page: Page }) {
	return page.evaluate(() =>
		JSON.stringify(
			(window as unknown as ReferenceWindow).__timelineStore.getState().tracks
		)
	);
}

async function openGroup({
	controls,
	name,
}: {
	controls: Locator;
	name: string;
}) {
	const group = controls.getByRole("button", { name, exact: true });
	if ((await group.getAttribute("aria-expanded")) === "false")
		await group.click();
}

async function setValue({
	lab,
	label,
	value,
}: {
	lab: Locator;
	label: string;
	value: number;
}) {
	const input = lab.getByLabel(label, { exact: true });
	await input.fill(String(value));
	await input.press("Tab");
	await expect(input).toHaveValue(String(value));
}

async function renderIndependent({
	lab,
	page,
	name,
}: {
	lab: Locator;
	page: Page;
	name: string;
}) {
	const image = lab.getByRole("img", { name: INDEPENDENT, exact: true });
	// Results are invalidated on every change, so a visible image is the new render.
	await expect(image).toHaveCount(0);
	await lab.getByRole("button", { name: "自研处理", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await image.isVisible()) || (await lab.getByRole("alert").isVisible()),
			{ timeout: 120_000 }
		)
		.toBe(true);
	if (await lab.getByRole("alert").isVisible()) {
		await page.screenshot({ path: path.join(output, `${name}-failed.png`) });
		throw new Error(await lab.getByRole("alert").innerText());
	}
}

test("Beauty Lab independent render keeps zero identity, native parity and its own PNG", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires an opaque portrait plus the private native and independent runtimes"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-beauty-independent-")
	);
	const app = await startElectronApp({ userDataDirectory });
	const errors: string[] = [];
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		const before = await timelineSnapshot({ page });
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		const status = lab.getByRole("status", { name: "实验室状态" });
		await expect(status).toContainText("原生运行时就绪");
		// Readiness includes the payload hashes and the Python/Bun/Metal preflight.
		await expect(status).toContainText("自研就绪", { timeout: 60_000 });
		await lab.getByLabel("实验室图片", { exact: true }).setInputFiles(source);
		await expect(status).toContainText(path.basename(source));

		await renderIndependent({ lab, page, name: "zero" });
		await expect(
			lab.getByRole("figure", { name: `原图 → ${INDEPENDENT}`, exact: true })
		).toContainText(/变化像素\s*0 \//);

		// The signed-window acceptance composite: skin, shape, feature and pigment stages.
		const controls = lab.getByTestId("beauty-lab-controls");
		await setValue({ lab, label: "美白数值", value: 45 });
		await openGroup({ controls, name: "脸型" });
		await setValue({ lab, label: "瘦脸数值", value: 35 });
		await openGroup({ controls, name: "五官精修" });
		await controls.getByRole("button", { name: "鼻子", exact: true }).click();
		await setValue({ lab, label: "瘦鼻数值", value: 25 });
		await openGroup({ controls, name: "美妆" });
		const makeup = controls.getByTestId("portrait-section-makeup");
		await makeup.getByRole("tab", { name: "口红", exact: true }).click();
		await makeup.getByRole("button", { name: "珊瑚裸粉", exact: true }).click();
		await setValue({ lab, label: "程度数值", value: 40 });

		await lab.getByRole("button", { name: "原生处理", exact: true }).click();
		await expect(
			lab.getByRole("img", { name: "原生结果", exact: true })
		).toBeVisible({ timeout: 60_000 });
		await renderIndependent({ lab, page, name: "composite" });
		await page.screenshot({
			path: path.join(output, "independent-composite.png"),
			animations: "disabled",
		});

		const zip = await saveComparison({
			app,
			page,
			destination: path.join(output, "independent-comparison.zip"),
		});
		expect(Object.keys(zip.files).sort()).toEqual([
			"comparison.json",
			"difference-native-independent.png",
			"difference-original-independent.png",
			"difference-original-native.png",
			"independent.png",
			"native.png",
			"original.png",
		]);
		const report = JSON.parse(
			await zip.file("comparison.json")!.async("string")
		) as ComparisonReport;
		expect(report.mode).toBe("independent-live");
		expect(report.independentResultPresent).toBe(true);
		expect(report.adjustments.values).toMatchObject({
			face_adjust_Whiten: 45,
			face_adjust_TotalFace: 35,
			face_adjust_Nose: 25,
		});
		expect(report.adjustments.makeup?.lip).toEqual({
			cardId: "lip-coral-nude",
			intensity: 40,
		});
		expect(report.independentProvenance).toMatchObject({
			provider: "qcut-independent-photo-v1",
			report: {
				passed: true,
				nativeInputsUsed: false,
				nativeFallbackUsed: false,
				nativeGeometryUsed: false,
			},
		});
		// The ZIP must carry the engine's own PNG bytes, not a re-encode.
		const png = await zip.file("independent.png")!.async("nodebuffer");
		expect(createHash("sha256").update(png).digest("hex")).toBe(
			report.independentProvenance?.report.outputPngSha256
		);
		expect(
			comparison({ report, name: "original-independent" }).changedPixels
		).toBeGreaterThan(100);
		const parity = comparison({ report, name: "native-independent" });
		expect(parity.rgbMax).toBeLessThanOrEqual(1);
		expect(parity.alphaMax).toBe(0);
		await verifyDifferencePNG({
			zip,
			name: "difference-native-independent.png",
			changedPixels: parity.changedPixels,
			width: report.width,
			height: report.height,
		});
		expect(await timelineSnapshot({ page })).toBe(before);
		expect(errors).toEqual([]);
	} finally {
		await app.close();
		await rm(userDataDirectory, { recursive: true, force: true });
	}
});
