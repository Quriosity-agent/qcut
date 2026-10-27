import { describe, expect, test } from "vitest";
import { parseCliArgs } from "../cli";
import { resolveCommandGroup } from "../command-groups";
import { getCommand, getCommandFlag } from "../command-registry";

describe("Sticker Lab command registry", () => {
	test("routes every Sticker Lab group action", () => {
		for (const [action, command] of [
			["root", "sticker-lab-root"],
			["set-root", "sticker-lab-set-root"],
			["reset-root", "sticker-lab-reset-root"],
			["catalogs", "sticker-lab-catalogs"],
			["categories", "sticker-lab-categories"],
			["items", "sticker-lab-items"],
			["search", "sticker-lab-search"],
		] as const) {
			expect(resolveCommandGroup(["sticker-lab", action])).toEqual({
				command,
				remainingArgs: [],
			});
			expect(getCommand(command)?.category).toBe("sticker-lab");
		}
	});

	test("parses a persistent root change and documents its required path", () => {
		expect(
			parseCliArgs([
				"sticker-lab",
				"set-root",
				"--root",
				"/Volumes/External/QCut Sticker Lab",
				"--json",
			])
		).toMatchObject({
			command: "sticker-lab-set-root",
			root: "/Volumes/External/QCut Sticker Lab",
			json: true,
		});
		expect(getCommandFlag("sticker-lab-set-root", "--root")).toMatchObject({
			required: true,
		});
	});

	test("keeps root inspection and reset separate from an asset path", () => {
		for (const action of ["root", "reset-root"]) {
			expect(parseCliArgs(["sticker-lab", action, "--json"])).toMatchObject({
				command: `sticker-lab-${action}`,
				json: true,
			});
			expect(getCommandFlag(`sticker-lab-${action}`, "--root")).toBeUndefined();
		}
	});

	test("parses browse filters and pagination", () => {
		const options = parseCliArgs([
			"sticker-lab",
			"items",
			"--root",
			"/private/sticker-lab",
			"--batch-id",
			"jianying-2026-08-23-batch-18-v2",
			"--category",
			"热门",
			"--query",
			"安排",
			"--offset",
			"10",
			"--limit",
			"25",
		]);

		expect(options).toMatchObject({
			command: "sticker-lab-items",
			root: "/private/sticker-lab",
			batchId: "jianying-2026-08-23-batch-18-v2",
			category: "热门",
			query: "安排",
			offset: 10,
			limit: 25,
		});
	});

	test("documents the required search query", () => {
		expect(getCommandFlag("sticker-lab-search", "--query")).toMatchObject({
			name: "--query",
			required: true,
		});
	});

	test("parses an explicit local provider for editor sticker add", () => {
		const options = parseCliArgs([
			"editor",
			"sticker",
			"add",
			"--project-id",
			"project-1",
			"--provider",
			"sticker-lab",
			"--batch-id",
			"jianying-2026-08-23-batch-18-v2",
			"--sticker-id",
			"7134619769205951784",
			"--root",
			"/private/sticker-lab",
			"--end-time",
			"5",
		]);

		expect(options).toMatchObject({
			command: "editor:sticker:add",
			projectId: "project-1",
			provider: "sticker-lab",
			batchId: "jianying-2026-08-23-batch-18-v2",
			stickerId: "7134619769205951784",
			root: "/private/sticker-lab",
			endTime: 5,
		});
	});
});
