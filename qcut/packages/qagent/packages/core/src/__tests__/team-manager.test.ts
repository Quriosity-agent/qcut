import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
	TEAM_PROTOCOL_TYPE,
	createTeamManager,
	parseTeamProtocolMessage,
} from "../team-manager.js";

let rootDir: string;

beforeEach(() => {
	rootDir = join(tmpdir(), `ao-test-team-${randomUUID()}`);
	mkdirSync(rootDir, { recursive: true });
});

afterEach(() => {
	rmSync(rootDir, { recursive: true, force: true });
});

describe("team manager", () => {
	it("creates team inboxes on init", async () => {
		const manager = createTeamManager({ rootDir });
		const team = await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead", "observer"],
		});

		expect(team.members).toEqual(["observer", "team-lead"]);
		expect(existsSync(join(team.inboxesDir, "team-lead.json"))).toBe(true);
		expect(existsSync(join(team.inboxesDir, "observer.json"))).toBe(true);
	});

	it("appends messages and supports unread read/ack flow", async () => {
		const manager = createTeamManager({ rootDir });
		await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead"],
		});

		await manager.sendMessage({
			teamId: "alpha-team",
			from: "observer",
			to: "team-lead",
			text: "Hello lead, I am online.",
			summary: "Observer reporting in",
			color: "blue",
		});

		const unread = await manager.readInbox({
			teamId: "alpha-team",
			member: "team-lead",
			unreadOnly: true,
		});
		expect(unread).toHaveLength(1);
		expect(unread[0].read).toBe(false);

		const consumed = await manager.readInbox({
			teamId: "alpha-team",
			member: "team-lead",
			unreadOnly: true,
			markAsRead: true,
		});
		expect(consumed).toHaveLength(1);
		expect(consumed[0].read).toBe(true);

		const unreadAfter = await manager.readInbox({
			teamId: "alpha-team",
			member: "team-lead",
			unreadOnly: true,
		});
		expect(unreadAfter).toHaveLength(0);
	});

	it("serializes and parses protocol messages", async () => {
		const manager = createTeamManager({ rootDir });
		await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead", "observer"],
		});

		await manager.sendProtocol({
			teamId: "alpha-team",
			from: "observer",
			to: "team-lead",
			type: TEAM_PROTOCOL_TYPE.IDLE_NOTIFICATION,
			payload: { idleReason: "available" },
		});

		const messages = await manager.readInbox({
			teamId: "alpha-team",
			member: "team-lead",
		});
		expect(messages).toHaveLength(1);

		const protocol = parseTeamProtocolMessage({ message: messages[0] });
		expect(protocol).not.toBeNull();
		expect(protocol!.type).toBe("idle_notification");
		expect(protocol!.from).toBe("observer");
		expect(protocol!.idleReason).toBe("available");
	});

	it("marks all unread messages as read", async () => {
		const manager = createTeamManager({ rootDir });
		await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead", "observer"],
		});

		await manager.sendMessage({
			teamId: "alpha-team",
			from: "observer",
			to: "team-lead",
			text: "one",
		});
		await manager.sendMessage({
			teamId: "alpha-team",
			from: "observer",
			to: "team-lead",
			text: "two",
		});

		const updated = await manager.markAllRead({
			teamId: "alpha-team",
			member: "team-lead",
		});
		expect(updated).toBe(2);

		const unread = await manager.readInbox({
			teamId: "alpha-team",
			member: "team-lead",
			unreadOnly: true,
		});
		expect(unread).toHaveLength(0);
	});

	it("rejects unsafe team/member IDs", async () => {
		const manager = createTeamManager({ rootDir });

		await expect(
			manager.ensureTeam({
				teamId: "../escape",
				members: ["team-lead"],
			})
		).rejects.toThrow("Failed to initialize team");
		await expect(
			manager.addMember({
				teamId: "alpha-team",
				member: "../escape",
			})
		).rejects.toThrow("Failed to add member");
	});

	it("preserves inbox history format as JSON array", async () => {
		const manager = createTeamManager({ rootDir });
		await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead", "observer"],
		});

		const inboxPath = join(rootDir, "alpha-team", "inboxes", "team-lead.json");
		writeFileSync(
			inboxPath,
			JSON.stringify([
				{
					from: "observer",
					text: "first",
					timestamp: "2026-02-12T09:21:46.491Z",
					read: false,
				},
			]),
			"utf-8"
		);

		await manager.sendMessage({
			teamId: "alpha-team",
			from: "observer",
			to: "team-lead",
			text: "second",
		});

		const saved = JSON.parse(readFileSync(inboxPath, "utf-8")) as unknown[];
		expect(Array.isArray(saved)).toBe(true);
		expect(saved).toHaveLength(2);
	});

	it("handles concurrent writes without losing messages", async () => {
		const manager = createTeamManager({ rootDir });
		await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead", "observer"],
		});

		const sendCount = 50;
		await Promise.all(
			Array.from({ length: sendCount }, (_, index) =>
				manager.sendMessage({
					teamId: "alpha-team",
					from: "observer",
					to: "team-lead",
					text: `msg-${index}`,
				})
			)
		);

		const all = await manager.readInbox({
			teamId: "alpha-team",
			member: "team-lead",
		});
		expect(all).toHaveLength(sendCount);
		expect(new Set(all.map((message) => message.text)).size).toBe(sendCount);
	});

	it("throws when inbox file is malformed JSON", async () => {
		const manager = createTeamManager({ rootDir });
		await manager.ensureTeam({
			teamId: "alpha-team",
			members: ["team-lead"],
		});

		const inboxPath = join(rootDir, "alpha-team", "inboxes", "team-lead.json");
		writeFileSync(inboxPath, "{ bad json", "utf-8");

		await expect(
			manager.readInbox({
				teamId: "alpha-team",
				member: "team-lead",
			})
		).rejects.toThrow("Failed to read inbox");
	});
});
