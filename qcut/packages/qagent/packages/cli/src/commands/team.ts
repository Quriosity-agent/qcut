import { readFileSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import {
	createTeamManager,
	parseTeamProtocolMessage,
} from "@composio/ao-core";

interface TeamRootOptions {
	root?: string;
}

interface TeamSendOptions extends TeamRootOptions {
	file?: string;
	summary?: string;
	color?: string;
	protocol?: string;
	payload?: string;
}

interface TeamInboxOptions extends TeamRootOptions {
	unread?: boolean;
	markRead?: boolean;
	limit?: string;
	json?: boolean;
}

function resolveTeamRoot({ root }: TeamRootOptions): string {
	return root ?? process.env.QAGENT_TEAM_ROOT ?? "~/.claude/teams";
}

function parseJsonObject({
	value,
	flagName,
}: {
	value: string;
	flagName: string;
}): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(`${flagName} must be valid JSON`, { cause: error });
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${flagName} must be a JSON object`);
	}

	return parsed as Record<string, unknown>;
}

function getMessageText({
	messageParts,
	file,
}: {
	messageParts: string[];
	file?: string;
}): string {
	if (file) {
		try {
			return readFileSync(file, "utf-8");
		} catch (error) {
			throw new Error(`Failed to read message file: ${file}`, {
				cause: error,
			});
		}
	}

	return messageParts.join(" ");
}

function parseLimit({
	limit,
}: {
	limit?: string;
}): number | undefined {
	if (!limit) {
		return undefined;
	}

	const parsed = Number.parseInt(limit, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new Error("--limit must be a positive integer");
	}
	return parsed;
}

export function registerTeam(program: Command): void {
	const team = program
		.command("team")
		.description("Filesystem-backed team inboxes (JSON files under ~/.claude/teams)");

	team
		.command("init")
		.description("Initialize a team inbox directory with member inbox files")
		.argument("<team-id>", "Team identifier")
		.argument("<members...>", "Member names (e.g. team-lead observer)")
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.action(
			async (
				teamId: string,
				members: string[],
				options: TeamRootOptions
			): Promise<void> => {
				try {
					const manager = createTeamManager({
						rootDir: resolveTeamRoot({ root: options.root }),
					});
					const result = await manager.ensureTeam({ teamId, members });
					console.log(
						chalk.green(
							`Initialized team '${teamId}' at ${result.inboxesDir} (${result.members.length} members)`
						)
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to initialize team: ${message}`));
					process.exit(1);
				}
			}
		);

	team
		.command("add-member")
		.description("Add a new member inbox file to an existing team")
		.argument("<team-id>", "Team identifier")
		.argument("<member>", "Member name")
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.action(
			async (
				teamId: string,
				member: string,
				options: TeamRootOptions
			): Promise<void> => {
				try {
					const manager = createTeamManager({
						rootDir: resolveTeamRoot({ root: options.root }),
					});
					await manager.addMember({ teamId, member });
					console.log(
						chalk.green(`Added member '${member}' to team '${teamId}'`)
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to add member: ${message}`));
					process.exit(1);
				}
			}
		);

	team
		.command("members")
		.description("List members (inbox files) in a team")
		.argument("<team-id>", "Team identifier")
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.action(
			async (teamId: string, options: TeamRootOptions): Promise<void> => {
				try {
					const manager = createTeamManager({
						rootDir: resolveTeamRoot({ root: options.root }),
					});
					const members = await manager.listMembers({ teamId });
					if (members.length === 0) {
						console.log(chalk.dim(`No members found for '${teamId}'`));
						return;
					}
					for (const member of members) {
						console.log(member);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to list members: ${message}`));
					process.exit(1);
				}
			}
		);

	team
		.command("send")
		.description("Append a message to a teammate inbox")
		.argument("<team-id>", "Team identifier")
		.argument("<from>", "Sender")
		.argument("<to>", "Recipient member")
		.argument("[message...]", "Message text")
		.option("-f, --file <path>", "Read message text from a file")
		.option("--summary <summary>", "Optional short summary")
		.option("--color <color>", "Optional color label")
		.option(
			"--protocol <type>",
			"Send a protocol payload (JSON string stored in text field)"
		)
		.option(
			"--payload <json>",
			"JSON object merged into protocol payload (for --protocol)"
		)
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.action(
			async (
				teamId: string,
				from: string,
				to: string,
				messageParts: string[],
				options: TeamSendOptions
			): Promise<void> => {
				try {
					const manager = createTeamManager({
						rootDir: resolveTeamRoot({ root: options.root }),
					});
					if (options.protocol) {
						const payload = options.payload
							? parseJsonObject({
									value: options.payload,
									flagName: "--payload",
								})
							: undefined;
						const sent = await manager.sendProtocol({
							teamId,
							from,
							to,
							type: options.protocol,
							payload,
							summary: options.summary,
							color: options.color,
						});
						console.log(
							chalk.green(
								`Protocol '${options.protocol}' sent to ${to} at ${sent.timestamp}`
							)
						);
						return;
					}

					const text = getMessageText({
						messageParts,
						file: options.file,
					});
					if (!text.trim()) {
						throw new Error("message text is required when --protocol is not set");
					}

					const sent = await manager.sendMessage({
						teamId,
						from,
						to,
						text,
						summary: options.summary,
						color: options.color,
					});
					console.log(
						chalk.green(`Message sent to ${to} at ${sent.timestamp}`)
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to send team message: ${message}`));
					process.exit(1);
				}
			}
		);

	team
		.command("inbox")
		.description("Read messages from a member inbox")
		.argument("<team-id>", "Team identifier")
		.argument("<member>", "Member name")
		.option("--unread", "Return only unread messages")
		.option("--mark-read", "Mark returned messages as read")
		.option("--limit <count>", "Return only the latest N matching messages")
		.option("--json", "Print JSON output")
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.action(
			async (
				teamId: string,
				member: string,
				options: TeamInboxOptions
			): Promise<void> => {
				try {
					const manager = createTeamManager({
						rootDir: resolveTeamRoot({ root: options.root }),
					});
					const limit = parseLimit({ limit: options.limit });
					const messages = await manager.readInbox({
						teamId,
						member,
						unreadOnly: options.unread,
						markAsRead: options.markRead,
						limit,
					});

					if (options.json) {
						console.log(JSON.stringify(messages, null, 2));
						return;
					}
					if (messages.length === 0) {
						console.log(chalk.dim("No messages."));
						return;
					}

					for (const message of messages) {
						const protocol = parseTeamProtocolMessage({ message });
						const protocolType = protocol ? ` [${protocol.type}]` : "";
						const stateLabel = message.read ? "read" : "unread";
						const summary = message.summary ? ` | ${message.summary}` : "";
						console.log(
							`${message.timestamp} ${message.from} (${stateLabel})${protocolType}${summary}`
						);
						console.log(message.text);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to read inbox: ${message}`));
					process.exit(1);
				}
			}
		);

	team
		.command("ack")
		.description("Mark all messages in a member inbox as read")
		.argument("<team-id>", "Team identifier")
		.argument("<member>", "Member name")
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.action(
			async (
				teamId: string,
				member: string,
				options: TeamRootOptions
			): Promise<void> => {
				try {
					const manager = createTeamManager({
						rootDir: resolveTeamRoot({ root: options.root }),
					});
					const count = await manager.markAllRead({ teamId, member });
					console.log(
						chalk.green(
							`Marked ${count} message${count === 1 ? "" : "s"} as read`
						)
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to ack inbox: ${message}`));
					process.exit(1);
				}
			}
		);
}
