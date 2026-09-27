// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("portrait package diagnostic argument guards", () => {
	it.each([
		{ key: "face_adjust", values: "[]" },
		{ key: "face_adjust", values: "[50,50]" },
		{ key: "face_adjust", values: "[101]" },
		{ key: "face_adjust", values: "[-101]" },
		{ key: "face_adjust", values: '["50"]' },
		{ key: "face_adjust", values: "[1e999]" },
		{
			key: "face_adjust",
			values: JSON.stringify(Array.from({ length: 26 }, (_, i) => i)),
		},
		{ key: "", values: "[50]" },
		// Malformed JSON must report the documented contract, not a raw SyntaxError.
		{ key: "face_adjust", values: "[50," },
		{ key: "face_adjust", values: "not json" },
	])("rejects $values before opening a source or native runtime", ({
		key,
		values,
	}) => {
		const result = spawnSync(
			"bun",
			[
				path.resolve("scripts/audit-portrait-package-reference.ts"),
				"--source",
				"/missing-portrait-input",
				"--output",
				"/missing-portrait-output",
				"--package",
				"/missing-portrait-package",
				...(key ? ["--key", key] : []),
				"--values",
				values,
			],
			{ encoding: "utf8", timeout: 10_000 }
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Values requires --key and a JSON array");
	});
});
