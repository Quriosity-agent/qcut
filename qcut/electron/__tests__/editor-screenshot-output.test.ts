import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleEditorCommand } from "../native-pipeline/cli/cli-handlers-editor.js";
import {
	moveScreenshot,
	resolveScreenshotOutputPath,
} from "../native-pipeline/cli/screenshot-output.js";
import {
	BASE_URL,
	clearRoutes,
	installFetchMock,
	makeOpts,
	mockRoute,
	noopProgress,
	originalFetch,
} from "./editor-cli-test-setup";

const workDir = mkdtempSync(path.join(tmpdir(), "qcut-screenshot-output-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** A capture as QCut leaves it in its recordings folder. */
function savedCapture(name: string): string {
	const filePath = path.join(workDir, "QCut Recordings", name);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, "png-bytes");
	return filePath;
}

describe("resolveScreenshotOutputPath", () => {
	it("adds .png when the path has no extension", () => {
		expect(resolveScreenshotOutputPath({ requested: "/shots/after-sfx" })).toBe(
			path.resolve("/shots/after-sfx.png")
		);
	});

	it("refuses another image format", () => {
		expect(() =>
			resolveScreenshotOutputPath({ requested: "/shots/after.jpg" })
		).toThrow("Screenshots are PNG files; give --output a .png path");
	});
});

describe("moveScreenshot", () => {
	it("moves the saved capture to the requested path", async () => {
		const sourcePath = savedCapture("screenshot-1.png");
		const outputPath = path.join(workDir, "nested", "door-plan.png");

		await moveScreenshot({ sourcePath, outputPath });

		expect(readFileSync(outputPath, "utf-8")).toBe("png-bytes");
		expect(existsSync(sourcePath)).toBe(false);
	});
});

describe("moveScreenshot over an existing file", () => {
	it("replaces the file once the new capture is in place", async () => {
		const sourcePath = savedCapture("screenshot-3.png");
		const outputPath = path.join(workDir, "replace", "shot.png");
		mkdirSync(path.dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, "old-shot");

		await moveScreenshot({ sourcePath, outputPath });

		expect(readFileSync(outputPath, "utf-8")).toBe("png-bytes");
	});

	it("keeps the existing file when the capture is missing", async () => {
		const outputPath = path.join(workDir, "keep", "shot.png");
		mkdirSync(path.dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, "old-shot");

		await expect(
			moveScreenshot({
				sourcePath: path.join(workDir, "QCut Recordings", "gone.png"),
				outputPath,
			})
		).rejects.toThrow();

		expect(readFileSync(outputPath, "utf-8")).toBe("old-shot");
		expect(
			readdirSync(path.dirname(outputPath)).filter((name) =>
				name.endsWith(".partial")
			)
		).toEqual([]);
	});
});

describe("editor:screenshot:capture --output", () => {
	beforeAll(() => installFetchMock(BASE_URL));
	afterEach(() => clearRoutes());
	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it("saves the screenshot where the caller asked", async () => {
		const sourcePath = savedCapture("screenshot-2.png");
		const outputPath = path.join(workDir, "evidence", "timeline.png");
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("POST", "/api/claude/screenshot/capture", {
			success: true,
			data: { filePath: sourcePath, width: 1280, height: 720 },
		});

		const result = await handleEditorCommand(
			makeOpts({
				command: "editor:screenshot:capture",
				output: path.join(workDir, "evidence", "timeline"),
			}),
			noopProgress
		);

		expect(result).toMatchObject({
			success: true,
			outputPath,
			data: { filePath: outputPath, width: 1280, height: 720 },
		});
		expect(readFileSync(outputPath, "utf-8")).toBe("png-bytes");
	});
});
