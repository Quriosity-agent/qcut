import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerTeam } from "../../src/commands/team.js";

vi.mock("@composio/ao-core", async () => {
	const teamManager = await import("../../../core/src/team-manager.ts");
	return {
		createTeamManager: teamManager.createTeamManager,
		parseTeamProtocolMessage: teamManager.parseTeamProtocolMessage,
	};
});

let program: Command;
let rootDir: string;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	rootDir = mkdtempSync(join(tmpdir(), "ao-team-cmd-"));
	program = new Command();
	program.exitOverride();
	registerTeam(program);

	consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`process.exit(${code})`);
	});
});

afterEach(() => {
	rmSync(rootDir, { recursive: true, force: true });
	consoleLogSpy.mockRestore();
	consoleErrorSpy.mockRestore();
	exitSpy.mockRestore();
});

describe("team command", () => {
	it("initializes team inbox files and lists members", async () => {
		await program.parseAsync([
			"node",
			"test",
			"team",
			"init",
			"alpha-team",
			"team-lead",
			"observer",
			"--root",
			rootDir,
		]);

		expect(
			existsSync(join(rootDir, "alpha-team", "inboxes", "team-lead.json"))
		).toBe(true);
		expect(
			existsSync(join(rootDir, "alpha-team", "inboxes", "observer.json"))
		).toBe(true);

		consoleLogSpy.mockClear();
		await program.parseAsync([
			"node",
			"test",
			"team",
			"members",
			"alpha-team",
			"--root",
			rootDir,
		]);

		const output = consoleLogSpy.mock.calls.map((call) => String(call[0]));
		expect(output).toContain("observer");
		expect(output).toContain("team-lead");
	});

	it("sends messages and marks unread entries as read", async () => {
		await program.parseAsync([
			"node",
			"test",
			"team",
			"init",
			"alpha-team",
			"team-lead",
			"observer",
			"--root",
			rootDir,
		]);

		await program.parseAsync([
			"node",
			"test",
			"team",
			"send",
			"alpha-team",
			"observer",
			"team-lead",
			"Hello",
			"lead",
			"--root",
			rootDir,
		]);

		consoleLogSpy.mockClear();
		await program.parseAsync([
			"node",
			"test",
			"team",
			"inbox",
			"alpha-team",
			"team-lead",
			"--unread",
			"--json",
			"--root",
			rootDir,
		]);

		const unreadPayload = String(
			consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1][0]
		);
		const unread = JSON.parse(unreadPayload) as Array<{
			text: string;
			read: boolean;
		}>;
		expect(unread).toHaveLength(1);
		expect(unread[0].text).toContain("Hello lead");
		expect(unread[0].read).toBe(false);

		consoleLogSpy.mockClear();
		await program.parseAsync([
			"node",
			"test",
			"team",
			"inbox",
			"alpha-team",
			"team-lead",
			"--unread",
			"--mark-read",
			"--json",
			"--root",
			rootDir,
		]);

		const consumedPayload = String(
			consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1][0]
		);
		const consumed = JSON.parse(consumedPayload) as Array<{ read: boolean }>;
		expect(consumed).toHaveLength(1);
		expect(consumed[0].read).toBe(true);

		consoleLogSpy.mockClear();
		await program.parseAsync([
			"node",
			"test",
			"team",
			"inbox",
			"alpha-team",
			"team-lead",
			"--unread",
			"--json",
			"--root",
			rootDir,
		]);
		const afterPayload = String(
			consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1][0]
		);
		const unreadAfter = JSON.parse(afterPayload) as unknown[];
		expect(unreadAfter).toEqual([]);
	});

	it("sends protocol messages as JSON-serialized text", async () => {
		await program.parseAsync([
			"node",
			"test",
			"team",
			"init",
			"alpha-team",
			"team-lead",
			"observer",
			"--root",
			rootDir,
		]);

		await program.parseAsync([
			"node",
			"test",
			"team",
			"send",
			"alpha-team",
			"observer",
			"team-lead",
			"--protocol",
			"idle_notification",
			"--payload",
			'{"idleReason":"available"}',
			"--root",
			rootDir,
		]);

		consoleLogSpy.mockClear();
		await program.parseAsync([
			"node",
			"test",
			"team",
			"inbox",
			"alpha-team",
			"team-lead",
			"--json",
			"--root",
			rootDir,
		]);

		const payload = String(
			consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1][0]
		);
		const inbox = JSON.parse(payload) as Array<{ text: string }>;
		expect(inbox).toHaveLength(1);

		const protocol = JSON.parse(inbox[0].text) as Record<string, unknown>;
		expect(protocol.type).toBe("idle_notification");
		expect(protocol.from).toBe("observer");
		expect(protocol.idleReason).toBe("available");
	});

	it("rejects invalid --payload JSON", async () => {
		await program.parseAsync([
			"node",
			"test",
			"team",
			"init",
			"alpha-team",
			"team-lead",
			"observer",
			"--root",
			rootDir,
		]);

		await expect(
			program.parseAsync([
				"node",
				"test",
				"team",
				"send",
				"alpha-team",
				"observer",
				"team-lead",
				"--protocol",
				"idle_notification",
				"--payload",
				"{bad-json",
				"--root",
				rootDir,
			])
		).rejects.toThrow("process.exit(1)");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Failed to send team message")
		);
	});

	it("rejects empty non-protocol message", async () => {
		await program.parseAsync([
			"node",
			"test",
			"team",
			"init",
			"alpha-team",
			"team-lead",
			"observer",
			"--root",
			rootDir,
		]);

		await expect(
			program.parseAsync([
				"node",
				"test",
				"team",
				"send",
				"alpha-team",
				"observer",
				"team-lead",
				"--root",
				rootDir,
			])
		).rejects.toThrow("process.exit(1)");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("message text is required")
		);
	});
});
