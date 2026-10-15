import { describe, expect, it } from "vitest";
import { stemsBesideExportPath } from "../project-mix-stems";

describe("stems beside an export", () => {
	it("go in the export's folder, named after it", () => {
		expect(stemsBesideExportPath("/out/doors.mp4")).toEqual({
			outputDir: "/out",
			fileNamePrefix: "doors-",
		});
		expect(stemsBesideExportPath("C:\\renders\\doors.v2.mp4")).toEqual({
			outputDir: "C:\\renders",
			fileNamePrefix: "doors.v2-",
		});
		expect(stemsBesideExportPath("doors")).toEqual({
			outputDir: ".",
			fileNamePrefix: "doors-",
		});
	});
});
