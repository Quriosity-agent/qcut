import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultExportFileStem,
	exportTimestamp,
	freeExportPath,
	projectFileName,
} from "../claude/handlers/claude-export-handler/export-file-name.js";

const NOW = new Date(2026, 10, 8, 12, 47, 29);

describe("export file names (Q4, 2026-11-08 report)", () => {
	it("names an export after its project and the time", () => {
		expect(
			defaultExportFileStem({
				projectName: "兽族版开场 · 01–08 粗剪（预览v2）2026-11-08",
				projectId: "3d5dd593",
				now: NOW,
			})
		).toBe("兽族版开场 · 01–08 粗剪（预览v2）2026-11-08-2026-11-08-124729");
	});

	it("keeps letters of any script and drops what a file name cannot hold", () => {
		expect(projectFileName('A/B\\C: "D" <E> | F? *G*')).toBe(
			"A-B-C- -D- -E- - F- -G"
		);
		expect(projectFileName("  .hidden  name. ")).toBe("hidden name");
		expect(projectFileName("tab\tand\nnewline")).toBe("tab and newline");
		expect(Array.from(projectFileName("剪".repeat(100)))).toHaveLength(80);
	});

	it("falls back to the project id when the name leaves nothing", () => {
		expect(
			defaultExportFileStem({ projectName: "...", projectId: "p-1", now: NOW })
		).toBe("p-1-2026-11-08-124729");
		expect(defaultExportFileStem({ projectId: "p-1", now: NOW })).toBe(
			"p-1-2026-11-08-124729"
		);
	});

	it("adds -2, -3… rather than write over an export made in the same second", () => {
		const taken = new Set([
			path.join("/exports", "开场-2026-11-08-124729.mp4"),
			path.join("/exports", "开场-2026-11-08-124729-2.mp4"),
		]);
		const free = (stem: string) =>
			freeExportPath({
				directory: "/exports",
				stem,
				extension: "mp4",
				exists: (filePath) => taken.has(filePath),
			});
		expect(free("开场-2026-11-08-124729")).toBe(
			path.join("/exports", "开场-2026-11-08-124729-3.mp4")
		);
		expect(free("开场-2026-11-08-124730")).toBe(
			path.join("/exports", "开场-2026-11-08-124730.mp4")
		);
		// The extension is added, not guessed from a dot in the name.
		expect(free("cut v2.1-2026-11-08-124729")).toBe(
			path.join("/exports", "cut v2.1-2026-11-08-124729.mp4")
		);
	});

	it("stops searching when every name seems taken", () => {
		let asked = 0;
		const filePath = freeExportPath({
			directory: "/exports",
			stem: "开场-2026-11-08-124729",
			extension: "mp4",
			exists: () => {
				asked += 1;
				return true;
			},
		});
		expect(asked).toBe(999);
		expect(path.basename(filePath)).toMatch(
			/^开场-2026-11-08-124729-[0-9a-z]{1,8}\.mp4$/
		);
	});

	it("stamps local time to the second", () => {
		expect(exportTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe(
			"2026-01-02-030405"
		);
	});
});
