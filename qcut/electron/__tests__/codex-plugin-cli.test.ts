import { describe, expect, it } from "vitest";
import {
	createCodexInvocation,
	createDefaultCodexRunner,
	findAvailablePlugin,
	parseCodexOutput,
	type CodexPluginList,
} from "../codex-plugin-cli";

describe("Codex CLI invocation", () => {
	it("runs Windows command shims through the command processor", () => {
		expect(
			createCodexInvocation({
				candidate: "C:\\Users\\Peter\\AppData\\Roaming\\npm\\codex.cmd",
				platform: "win32",
				commandProcessor: "C:\\Windows\\System32\\cmd.exe",
			})
		).toEqual({
			executable: "C:\\Windows\\System32\\cmd.exe",
			prefixArgs: [
				"/d",
				"/s",
				"/c",
				"C:\\Users\\Peter\\AppData\\Roaming\\npm\\codex.cmd",
			],
		});
	});

	it("runs PowerShell shims with arguments kept separate", () => {
		expect(
			createCodexInvocation({
				candidate: "C:\\Users\\Peter\\AppData\\Roaming\\npm\\codex.ps1",
				platform: "win32",
				powerShell: "powershell.exe",
			})
		).toEqual({
			executable: "powershell.exe",
			prefixArgs: [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				"C:\\Users\\Peter\\AppData\\Roaming\\npm\\codex.ps1",
			],
		});
	});

	it("executes native binaries directly", () => {
		expect(
			createCodexInvocation({
				candidate: "C:\\Program Files\\Codex\\codex.exe",
				platform: "win32",
			})
		).toEqual({
			executable: "C:\\Program Files\\Codex\\codex.exe",
			prefixArgs: [],
		});
	});
});

describe("Codex CLI output", () => {
	it("parses JSON and accepts an empty successful response", () => {
		expect(parseCodexOutput({ stdout: '{"installed":[]}' })).toEqual({
			installed: [],
		});
		expect(parseCodexOutput({ stdout: " \n" })).toEqual({});
	});

	it("reports invalid CLI output clearly", () => {
		expect(() =>
			parseCodexOutput({ stdout: "warning: unsupported flag" })
		).toThrow("Codex CLI returned invalid JSON output");
	});
});

describe("Codex CLI runner", () => {
	const qcutPlugin = {
		pluginId: "qcut@custom",
		name: "qcut",
		marketplaceName: "custom",
		version: "1.0.0",
	};
	const script = `process.stdout.write(JSON.stringify({
		available: [
			{ name: "other", description: "x".repeat(7 * 1024 * 1024) },
			${JSON.stringify(qcutPlugin)},
		],
	}));`;
	const runCodex = createDefaultCodexRunner({
		initialInvocation: {
			executable: process.execPath,
			prefixArgs: ["-e", script, "--"],
		},
	});

	it("finds QCut at the end of a marketplace response larger than 4 MiB", async () => {
		const list = (await runCodex({
			args: ["plugin", "list", "--available", "--json"],
		})) as CodexPluginList;

		expect(findAvailablePlugin({ list })).toEqual(qcutPlugin);
	});

	it("keeps the regular output limit for other commands", async () => {
		await expect(
			runCodex({ args: ["plugin", "list", "--json"] })
		).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
	});
});
