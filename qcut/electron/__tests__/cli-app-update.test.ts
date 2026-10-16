import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";
import { getCommand } from "../native-pipeline/cli/command-registry.js";
import { HANDLER_MAP } from "../native-pipeline/cli/cli-runner/handler-map.js";

describe("QCut app update CLI", () => {
	it("registers the update command and its safety flags", () => {
		const command = getCommand("update");

		expect(command?.category).toBe("application");
		expect(command?.flags.map((flag) => flag.name)).toEqual([
			"--check",
			"--yes",
			"--no-launch",
		]);
		expect(HANDLER_MAP.update).toBeTypeOf("function");
	});

	it("registers the cli install/status commands under the cli group", () => {
		expect(getCommand("cli-install")?.category).toBe("application");
		expect(getCommand("cli-install")?.flags.map((flag) => flag.name)).toEqual([
			"--yes",
		]);
		expect(getCommand("cli-status")?.category).toBe("application");
		expect(HANDLER_MAP["cli-install"]).toBeTypeOf("function");
		expect(HANDLER_MAP["cli-status"]).toBeTypeOf("function");
		expect(parseCliArgs(["cli", "install", "--yes"])).toMatchObject({
			command: "cli-install",
			yes: true,
		});
		expect(parseCliArgs(["cli", "status"]).command).toBe("cli-status");
	});

	it("parses check, confirmation, and relaunch controls", () => {
		const options = parseCliArgs(["update", "--check", "--yes", "--no-launch"]);

		expect(options.command).toBe("update");
		expect(options.checkOnly).toBe(true);
		expect(options.yes).toBe(true);
		expect(options.noLaunch).toBe(true);
	});
});
