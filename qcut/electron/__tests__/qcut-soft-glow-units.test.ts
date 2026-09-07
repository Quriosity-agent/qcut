import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SOFT_GLOW_UNITS } from "../qcut-independent-filter/soft-glow-bridge.js";

const CMAKE_PATH = resolve(
	__dirname,
	"../../research/independent-soft-glow/CMakeLists.txt"
);
const HOST_TARGETS = ["softglow", "softglow_io", "softglow_stream_io"];

/** Source files a static library target lists in the CMake file. */
function librarySources({ target }: { target: string }): string[] {
	const cmake = readFileSync(CMAKE_PATH, "utf8");
	const match = new RegExp(`add_library\\(${target} STATIC ([^)]+)\\)`).exec(
		cmake
	);
	if (!match) throw new Error(`CMake target ${target} not found`);
	return match[1]
		.split(/\s+/)
		.filter((token) => token.endsWith(".cpp"))
		.map((token) => token.replace(/\.cpp$/, ""));
}

describe("soft glow host compile units", () => {
	it("covers every source of the CMake library targets the stream host links", () => {
		const expected = HOST_TARGETS.flatMap((target) =>
			librarySources({ target })
		);
		for (const unit of expected) {
			expect(SOFT_GLOW_UNITS, `missing ${unit}.cpp`).toContain(unit);
		}
		expect(SOFT_GLOW_UNITS).toContain("stream_main");
	});
});
