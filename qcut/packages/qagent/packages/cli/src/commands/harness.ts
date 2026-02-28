import chalk from "chalk";
import type { Command } from "commander";
import { getSessionManager } from "../lib/create-session-manager.js";
import { exec } from "../lib/shell.js";
import {
	applySpawnOverrides,
	buildPrompt,
	chooseProject,
	ensureAbsolutePath,
	parseInstruction,
	parseKeyValue,
	parseMode,
	parsePermissionValue,
	parseTaskText,
	parseThreadMode,
	parseTimeout,
} from "./harness-options.js";
import { runHarnessRelay } from "./harness-relay.js";
import {
	getTargetContext,
	makeSessionKey,
	removeSessionFromStore,
	resolveTarget,
	saveStore,
	updateRecord,
} from "./harness-store.js";
import {
	getSessionManagerForContext,
	printInstallInstructions,
	runCancel,
	sendSteer,
	showStatus,
} from "./harness-runtime.js";
import {
	RELAY_DEFAULT_DEDUP_CACHE_SIZE,
	RELAY_DEFAULT_PROTOCOL_TTL,
	RELAY_OUTPUT_MODE,
	VALID_MODE,
	VALID_THREAD_MODE,
	type HarnessOptionSetOptions,
	type HarnessRelayOptions,
	type HarnessRuntimeOptions,
	type HarnessSpawnOptions,
	type HarnessStatusOptions,
	type HarnessTargetOptions,
} from "./harness-types.js";

export function registerHarness(program: Command): void {
	const harness = program
		.command("harness")
		.description("External-harness style control surface for qagent sessions");

	harness
		.command("spawn")
		.description("Spawn a harness session with runtime options")
		.argument("<agent-id>", "Harness target agent (e.g. codex, claude-code)")
		.argument("[task...]", "Initial task prompt")
		.option("-p, --project <id>", "Project ID from config")
		.option("--mode <mode>", "persistent or oneshot", VALID_MODE.PERSISTENT)
		.option("--thread <mode>", "auto, here, or off", VALID_THREAD_MODE.OFF)
		.option("--label <name>", "Operator label")
		.option("--model <id>", "Runtime model override")
		.option("--permissions <profile>", "Runtime permissions profile")
		.option("--timeout <seconds>", "Runtime timeout in seconds")
		.option("--cwd <path>", "Runtime working directory override")
		.action(
			async (
				agentId: string,
				taskParts: string[],
				options: HarnessSpawnOptions
			): Promise<void> => {
				try {
					const context = getTargetContext();
					const projectId = chooseProject({
						config: context.config,
						projectId: options.project,
					});
					const mode = parseMode({ mode: options.mode });
					const threadMode = parseThreadMode({ thread: options.thread });
					const timeout = parseTimeout({ timeout: options.timeout });
					const taskText = parseTaskText({ parts: taskParts });
					if (mode === VALID_MODE.ONESHOT && !taskText) {
						throw new Error("oneshot mode requires a task message");
					}
					if (options.cwd) {
						ensureAbsolutePath({ cwd: options.cwd });
					}

					const runtimeOptions: HarnessRuntimeOptions = {};
					if (options.model) runtimeOptions.model = options.model;
					if (options.permissions) {
						runtimeOptions.permissions = parsePermissionValue({
							value: options.permissions,
						});
					}
					if (timeout !== undefined) runtimeOptions.timeout = timeout;
					if (options.cwd) runtimeOptions.cwd = options.cwd;

					const prompt = buildPrompt({
						taskText,
						mode,
						runtimeOptions,
					});

					const spawnConfig = applySpawnOverrides({
						config: context.config,
						projectId,
						agentId,
						runtimeOptions,
					});
					const sm = await getSessionManager(spawnConfig);
					const session = await sm.spawn({
						projectId,
						agent: agentId,
						prompt,
					});
					const key = makeSessionKey({
						agentId,
						sessionId: session.id,
					});
					const now = new Date().toISOString();
					const record = {
						key,
						sessionId: session.id,
						agentId,
						projectId,
						mode,
						threadMode,
						label: options.label,
						runtimeOptions,
						createdAt: now,
						updatedAt: now,
					};
					updateRecord({ context, record });

					console.log(chalk.green(`Spawned harness session ${key}`));
					console.log(chalk.dim(`  sessionId: ${session.id}`));
					console.log(chalk.dim(`  project:   ${projectId}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to spawn harness session: ${message}`));
					process.exit(1);
				}
			}
		);

	harness
		.command("status")
		.description("Show harness session state")
		.argument("[target]", "Session target (key, session id, or label)")
		.option("--json", "Output JSON")
		.action(async (target: string | undefined, options: HarnessStatusOptions) => {
			try {
				const context = getTargetContext();
				await showStatus({
					context,
					target,
					json: options.json,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to fetch harness status: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("sessions")
		.description("List harness sessions")
		.option("--json", "Output JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const context = getTargetContext();
				await showStatus({
					context,
					json: options.json,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to list harness sessions: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("steer")
		.description("Send steer instruction to target harness session")
		.argument("<instruction...>", "Instruction text")
		.option("-s, --session <target>", "Session target")
		.action(
			async (instructionParts: string[], options: HarnessTargetOptions) => {
				try {
					const instruction = parseInstruction({ parts: instructionParts });
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					await sendSteer({
						record,
						context,
						message: instruction,
					});
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					console.log(chalk.green(`Steered ${record.key}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to steer harness session: ${message}`));
					process.exit(1);
				}
			}
		);

	harness
		.command("cancel")
		.description("Cancel current turn on target harness session")
		.option("-s, --session <target>", "Session target")
		.action(async (options: HarnessTargetOptions) => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				await runCancel({
					record,
					context,
				});
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Cancelled active turn for ${record.key}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to cancel harness session: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("close")
		.description("Close target harness session and remove tracking")
		.option("-s, --session <target>", "Session target")
		.action(async (options: HarnessTargetOptions) => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				const sm = await getSessionManagerForContext({ context });
				try {
					await sm.kill(record.sessionId);
				} catch {
					// Best effort close; still remove the local tracking record.
				}
				removeSessionFromStore({
					store: context.store,
					key: record.key,
				});
				saveStore({
					storePath: context.storePath,
					store: context.store,
				});
				console.log(chalk.green(`Closed ${record.key}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to close harness session: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("relay")
		.description(
			"Run team<->harness bridge loop (inbox messages to harness; harness output back to peers)"
		)
		.requiredOption("--team <id>", "Team identifier")
		.requiredOption("--member <name>", "Team member bound to the harness session")
		.option(
			"--to <members>",
			"Comma-separated peer list (defaults to all members except --member)"
		)
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.option("-s, --session <target>", "Session target")
		.option("--interval <ms>", "Polling interval in milliseconds", "1500")
		.option("--batch <count>", "Unread inbox batch size per poll", "20")
		.option("--lines <count>", "Captured tmux output lines per poll", "120")
		.option(
			"--max-chars <count>",
			"Maximum outbound relay payload size per poll",
			"4000"
		)
		.option("--once", "Run one relay cycle then exit")
		.option("--no-output", "Disable harness->team output relay")
		.option(
			"--output-mode <mode>",
			"Outbound relay mode: protocol (default) or raw",
			RELAY_OUTPUT_MODE.PROTOCOL
		)
		.option(
			"--protocol-ttl <count>",
			"Default TTL for protocol messages when missing",
			String(RELAY_DEFAULT_PROTOCOL_TTL)
		)
		.option(
			"--dedup-cache <count>",
			"Max protocol message IDs to keep for dedup",
			String(RELAY_DEFAULT_DEDUP_CACHE_SIZE)
		)
		.option(
			"--emit-initial-output",
			"Forward current harness output snapshot on the first poll"
		)
		.action(async (options: HarnessRelayOptions): Promise<void> => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				await runHarnessRelay({
					options,
					context,
					record,
					onActivity: () => {
						record.updatedAt = new Date().toISOString();
						updateRecord({ context, record });
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to run harness relay: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("model")
		.description("Set model runtime option for target harness session")
		.argument("<model-id>", "Model identifier")
		.option("-s, --session <target>", "Session target")
		.option("--apply", "Send steer message to apply now")
		.action(
			async (modelId: string, options: HarnessOptionSetOptions): Promise<void> => {
				try {
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					record.runtimeOptions.model = modelId;
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					if (options.apply) {
						await sendSteer({
							record,
							context,
							message: `Use model '${modelId}' for subsequent turns if supported.`,
						});
					}
					console.log(chalk.green(`Set model on ${record.key}: ${modelId}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(
						chalk.red(`Failed to update harness model option: ${message}`)
					);
					process.exit(1);
				}
			}
		);

	harness
		.command("permissions")
		.description("Set permissions runtime option for target harness session")
		.argument("<profile>", "Permission profile")
		.option("-s, --session <target>", "Session target")
		.option("--apply", "Send steer message to apply now")
		.action(
			async (profile: string, options: HarnessOptionSetOptions): Promise<void> => {
				try {
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					record.runtimeOptions.permissions = parsePermissionValue({
						value: profile,
					});
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					if (options.apply) {
						await sendSteer({
							record,
							context,
							message: `Use permissions profile '${profile}' for subsequent turns if supported.`,
						});
					}
					console.log(chalk.green(`Set permissions on ${record.key}: ${profile}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(
						chalk.red(`Failed to update harness permissions option: ${message}`)
					);
					process.exit(1);
				}
			}
		);

	harness
		.command("timeout")
		.description("Set timeout runtime option for target harness session")
		.argument("<seconds>", "Timeout in seconds")
		.option("-s, --session <target>", "Session target")
		.action(async (seconds: string, options: HarnessTargetOptions) => {
			try {
				const timeout = parseTimeout({ timeout: seconds });
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				record.runtimeOptions.timeout = timeout;
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Set timeout on ${record.key}: ${timeout}s`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(
					chalk.red(`Failed to update harness timeout option: ${message}`)
				);
				process.exit(1);
			}
		});

	harness
		.command("cwd")
		.description("Set working directory runtime option for target harness session")
		.argument("<path>", "Absolute directory path")
		.option("-s, --session <target>", "Session target")
		.action(async (cwd: string, options: HarnessTargetOptions) => {
			try {
				ensureAbsolutePath({ cwd });
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				record.runtimeOptions.cwd = cwd;
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Set cwd on ${record.key}: ${cwd}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to update harness cwd option: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("set")
		.description("Set a generic runtime option key/value for target session")
		.argument("<key>", "Option key")
		.argument("<value>", "Option value")
		.option("-s, --session <target>", "Session target")
		.action(
			async (
				key: string,
				value: string,
				options: HarnessTargetOptions
			): Promise<void> => {
				try {
					if (!key.trim()) {
						throw new Error("key is required");
					}
					if (key === "cwd") {
						ensureAbsolutePath({ cwd: value });
					}
					const parsedValue = parseKeyValue({ key, value });
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					record.runtimeOptions[key] = parsedValue;
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					console.log(chalk.green(`Set ${key} on ${record.key}: ${value}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to set runtime option: ${message}`));
					process.exit(1);
				}
			}
		);

	harness
		.command("reset-options")
		.description("Clear all runtime option overrides for target session")
		.option("-s, --session <target>", "Session target")
		.action(async (options: HarnessTargetOptions) => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				record.runtimeOptions = {};
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Reset runtime options for ${record.key}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to reset runtime options: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("doctor")
		.description("Check harness command health and environment")
		.action(async () => {
			try {
				const context = getTargetContext();
				const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
				checks.push({
					name: "config",
					ok: true,
					detail: context.config.configPath ?? "(resolved)",
				});
				checks.push({
					name: "store",
					ok: true,
					detail: context.storePath,
				});
				try {
					await exec("tmux", ["-V"]);
					checks.push({ name: "tmux", ok: true, detail: "available" });
				} catch {
					checks.push({ name: "tmux", ok: false, detail: "not found" });
				}
				for (const check of checks) {
					const icon = check.ok ? chalk.green("OK") : chalk.yellow("WARN");
					console.log(`${icon} ${check.name}: ${check.detail}`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Harness doctor failed: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("install")
		.description("Print deterministic harness setup instructions")
		.action(() => {
			try {
				printInstallInstructions();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to print install guidance: ${message}`));
				process.exit(1);
			}
		});
}
