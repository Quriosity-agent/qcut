/**
 * N34: the stage where two exports of one project first diverge is still
 * unknown, because every intermediate is deleted when the export ends. The
 * switch that keeps them has to stay off unless it is asked for — a kept
 * directory holds a full-size intermediate video and a float-PCM master.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
	keepExportTempFiles,
	reportKeptExportDirectory,
} from "../claude/handlers/claude-export-handler/export-temp-retention.js";

const VARIABLE = "QCUT_EXPORT_KEEP_TEMP";

function setSwitch(value: string | undefined): void {
	if (value === undefined) {
		delete process.env[VARIABLE];
		return;
	}
	process.env[VARIABLE] = value;
}

afterEach(() => {
	setSwitch(undefined);
});

describe("export temp retention", () => {
	it("is off unless the switch is set", () => {
		setSwitch(undefined);
		expect(keepExportTempFiles()).toBe(false);
		expect(
			reportKeptExportDirectory({
				handler: "test",
				label: "intermediates",
				directory: "/tmp/export-123",
			})
		).toBe(false);
	});

	it("stays off for the values that mean off", () => {
		for (const value of ["", " ", "0", "false"]) {
			setSwitch(value);
			expect(keepExportTempFiles()).toBe(false);
		}
	});

	it("keeps the directory when asked, and says so to the caller", () => {
		setSwitch("1");
		expect(keepExportTempFiles()).toBe(true);
		expect(
			reportKeptExportDirectory({
				handler: "test",
				label: "intermediates",
				directory: "/tmp/export-123",
			})
		).toBe(true);
	});
});
