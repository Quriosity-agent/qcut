import { describe, expect, it } from "vitest";
import {
	defaultExportFileStem,
	exportTimestamp,
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

	it("stamps local time to the second", () => {
		expect(exportTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe(
			"2026-01-02-030405"
		);
	});
});
