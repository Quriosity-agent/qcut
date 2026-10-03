import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import type { MediaPortraitAdjustmentKey } from "../../../../../electron/jianying-portrait-adjustment-contract";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";
import {
	auditBeautyLabNativeZip,
	decodeBeautyLabFixture,
	saveBeautyLabComparison,
} from "./helpers/beauty-lab-comparison";

interface MatrixCase {
	id: string;
	values: Partial<Record<MediaPortraitAdjustmentKey, number>>;
	lip?: boolean;
}

const cases: MatrixCase[] = [
	{ id: "zero", values: {} },
	{ id: "smooth", values: { face_adjust_Smooth: 50 } },
	{ id: "spot-acne", values: { face_adjust_SpotAcne: 75 } },
	{
		id: "skin-tone",
		values: { face_adjust_skin_Intensity: 60, face_adjust_skin_ColdWarm: 25 },
	},
	{ id: "jawbone", values: { face_adjust_ZoomJawbone: 60 } },
	{ id: "chin", values: { face_adjust_Chin: 40 } },
	{ id: "eyes", values: { face_adjust_eye: 40 } },
	{ id: "nose", values: { face_adjust_3DNose_Big: 35 } },
	{ id: "mouth", values: { face_adjust_ZoomMouth: 40 } },
	{ id: "brows", values: { eyebrow_adjust_JianMei: 60 } },
	{ id: "lip", values: {}, lip: true },
	{
		id: "combined",
		values: {
			face_adjust_Smooth: 30,
			face_adjust_eye: 25,
			face_adjust_ZoomJawbone: 35,
		},
		lip: true,
	},
];
const groupLabels = {
	skin: "皮肤管理",
	"face-shape": "脸型",
	features: "五官精修",
};
const categoryLabels: Record<string, string> = {
	common: "常用",
	skin: "皮肤",
	eyes: "眼睛",
	nose: "鼻子",
	mouth: "嘴巴",
	brows: "眉毛",
	details: "精修",
};
const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_BEAUTY_MATRIX_OUTPUT ??
		"output/playwright/beauty-lab-native-matrix"
);

async function openGroup({
	controls,
	label,
}: {
	controls: Locator;
	label: string;
}) {
	const button = controls.getByRole("button", { name: label, exact: true });
	if ((await button.getAttribute("aria-expanded")) === "false")
		await button.click();
}

async function applyCase({
	controls,
	sample,
}: {
	controls: Locator;
	sample: MatrixCase;
}) {
	await Object.entries(sample.values).reduce(async (previous, [key, value]) => {
		await previous;
		const control = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
			(entry) => entry.key === key
		);
		if (!control || control.section === "body")
			throw new Error(`Unsupported portrait control ${key}`);
		await openGroup({ controls, label: groupLabels[control.section] });
		const section = controls.getByTestId(`portrait-section-${control.section}`);
		const category = section.getByRole("button", {
			name: categoryLabels[control.category ?? "common"],
			exact: true,
		});
		if (await category.count()) await category.click();
		const input = section.getByLabel(`${control.titleZh}数值`, { exact: true });
		await input.fill(String(value));
		await input.press("Tab");
		await expect(input).toHaveValue(String(value));
	}, Promise.resolve());
	if (sample.lip) {
		await openGroup({ controls, label: "美妆" });
		const makeup = controls.getByTestId("portrait-section-makeup");
		await makeup.getByRole("tab", { name: "口红", exact: true }).click();
		await makeup.getByRole("button", { name: "柔和粉", exact: true }).click();
	}
}

test("Beauty Lab real native matrix exports exact grayscale and isolated per-feature results", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires explicit portrait input and local native runtime"
	);
	test.setTimeout(600_000);
	if (!source) throw new Error("Missing portrait input");
	const sourceBytes = await readFile(source);
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-beauty-matrix-")
	);
	const app = await startElectronApp({ userDataDirectory });
	const samples: Array<Record<string, unknown>> = [];
	const pageErrors: string[] = [];
	let passed = false;
	try {
		const page = await getMainWindow(app);
		const expectedOriginalPNG = await decodeBeautyLabFixture({
			page,
			bytes: sourceBytes,
		});
		page.on("pageerror", (error) => pageErrors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		const timeline = () =>
			page.evaluate(() =>
				JSON.stringify(
					(window as unknown as ReferenceWindow).__timelineStore.getState()
						.tracks
				)
			);
		const before = await timeline();
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		const controls = lab.getByTestId("beauty-lab-controls");
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			"原生运行时就绪"
		);
		await cases.reduce(async (previous, sample) => {
			await previous;
			await lab.getByRole("button", { name: "清空对照", exact: true }).click();
			await lab.getByLabel("实验室图片", { exact: true }).setInputFiles(source);
			await expect(
				lab.getByRole("status", { name: "实验室状态" })
			).toContainText(path.basename(source));
			await applyCase({ controls, sample });
			await expect(
				lab.getByRole("img", { name: "原生结果", exact: true })
			).toHaveCount(0);
			await lab.getByRole("button", { name: "原生处理", exact: true }).click();
			await expect(
				lab.getByRole("img", { name: "原生结果", exact: true })
			).toBeVisible({ timeout: 60_000 });
			const zip = await saveBeautyLabComparison({
				app,
				page,
				destination: path.join(output, `${sample.id}.zip`),
			});
			const report = await auditBeautyLabNativeZip({
				zip,
				expectedOriginalPNG,
			});
			expect(report.gain).toBe(8);
			expect(report.adjustments.values).toEqual(sample.values);
			expect(report.adjustments.makeup ?? {}).toEqual(
				sample.lip ? { lip: { cardId: "lip-soft-pink", intensity: 80 } } : {}
			);
			if (sample.id === "zero")
				expect(report.comparisons[0].changedPixels).toBe(0);
			else
				expect(report.comparisons[0].changedPixels, sample.id).toBeGreaterThan(
					0
				);
			expect(report.comparisons[0].alphaMax).toBe(0);
			await Promise.all(
				["original", "native", "difference-original-native"].map(
					async (name) => {
						await writeFile(
							path.join(output, `${sample.id}-${name}.png`),
							await zip.file(`${name}.png`)!.async("nodebuffer")
						);
					}
				)
			);
			await lab
				.getByRole("img", { name: "原图 → 原生结果", exact: true })
				.scrollIntoViewIfNeeded();
			await page.screenshot({
				path: path.join(output, `${sample.id}-ui.png`),
				animations: "disabled",
			});
			expect(await timeline()).toBe(before);
			samples.push({ id: sample.id, ...report });
		}, Promise.resolve());
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				lab.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
			)
			.toBe(true);
		await lab
			.getByRole("img", { name: "原图 → 原生结果", exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(output, "combined-mobile.png"),
			animations: "disabled",
		});
		expect(pageErrors).toEqual([]);
		expect((await readFile(source)).equals(sourceBytes)).toBe(true);
		passed = true;
	} finally {
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					passed,
					source,
					sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
					sourcePixelsVerified: passed,
					backend: "real-native",
					arbitraryFrameCandidateReady: false,
					jianyingUiComparisonPerformed: false,
					expectedCases: cases.length,
					samples,
					pageErrors,
				},
				null,
				2
			)
		);
		await app.close();
	}
});
