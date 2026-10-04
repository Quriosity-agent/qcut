// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	BEAUTY_LAB_OWNED_RUN_ENV,
	BEAUTY_LAB_RESEARCH_RUN_ENV,
	resolveBeautyLabResearchPaths,
} from "../beauty-lab-research-config.js";

const sourceRoot = path.resolve("workspace");
const privateRoot = path.join(sourceRoot, ".local/jianying-model-pytorch");

describe("Beauty Lab main-process research run selection", () => {
	it("preserves legacy defaults without claiming they pass source verification", () => {
		expect(
			resolveBeautyLabResearchPaths({
				sourceRoot,
				isPackaged: false,
				environment: {},
			})
		).toEqual({
			root: path.join(privateRoot, "face-temporal-campaign-20261003-r1"),
			ownedChainRoot: path.join(
				privateRoot,
				"beauty-owned-chain-ui-20261003-r2"
			),
			currentSourceRoot: path.join(sourceRoot, "research"),
		});
	});
	it("selects fresh sibling runs without changing the source verification root", () => {
		const environment = {
			[BEAUTY_LAB_RESEARCH_RUN_ENV]: "fresh-capture-20261004-r1",
			[BEAUTY_LAB_OWNED_RUN_ENV]: "fresh-owned-20261004-r1",
			QCUT_BEAUTY_LAB_SOURCE_ROOT: "/untrusted/old-source",
		};
		expect(
			resolveBeautyLabResearchPaths({
				sourceRoot,
				isPackaged: false,
				environment,
			})
		).toEqual({
			root: path.join(privateRoot, environment[BEAUTY_LAB_RESEARCH_RUN_ENV]),
			ownedChainRoot: path.join(
				privateRoot,
				environment[BEAUTY_LAB_OWNED_RUN_ENV]
			),
			currentSourceRoot: path.join(sourceRoot, "research"),
		});
	});
	for (const key of [BEAUTY_LAB_RESEARCH_RUN_ENV, BEAUTY_LAB_OWNED_RUN_ENV]) {
		it.each([
			"",
			"..",
			"../stale",
			"/tmp/run",
			"nested/run",
			"nested\\run",
			"C:\\run",
			".hidden",
			"a.b",
			" spaced",
			"a\nb",
			"a\0b",
			"旧记录",
			"a".repeat(129),
		])(`rejects invalid ${key}: %j`, (value) => {
			expect(() =>
				resolveBeautyLabResearchPaths({
					sourceRoot,
					isPackaged: false,
					environment: { [key]: value },
				})
			).toThrow("bounded directory name");
		});
	}
	it("accepts the maximum bounded leaf name", () => {
		const value = "a".repeat(128);
		expect(
			resolveBeautyLabResearchPaths({
				sourceRoot,
				isPackaged: false,
				environment: { [BEAUTY_LAB_OWNED_RUN_ENV]: value },
			}).ownedChainRoot
		).toBe(path.join(privateRoot, value));
	});
	it("ignores even invalid development overrides in packaged applications", () => {
		expect(
			resolveBeautyLabResearchPaths({
				sourceRoot,
				isPackaged: true,
				environment: {
					[BEAUTY_LAB_RESEARCH_RUN_ENV]: "../private",
					[BEAUTY_LAB_OWNED_RUN_ENV]: "/tmp/private",
				},
			})
		).toEqual({
			root: path.join(privateRoot, "face-temporal-campaign-20261003-r1"),
			ownedChainRoot: undefined,
			currentSourceRoot: path.join(sourceRoot, "research"),
		});
	});
});
