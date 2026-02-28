import { isAbsolute } from "node:path";
import type { OrchestratorConfig } from "@composio/ao-core";
import {
	RELAY_OUTPUT_MODE,
	VALID_MODE,
	VALID_THREAD_MODE,
	type HarnessMode,
	type HarnessRuntimeOptions,
	type HarnessThreadMode,
	type RelayOutputMode,
} from "./harness-types.js";

export function parseMode({
	mode,
}: {
	mode?: string;
}): HarnessMode {
	if (!mode || mode === VALID_MODE.PERSISTENT) {
		return VALID_MODE.PERSISTENT;
	}
	if (mode === VALID_MODE.ONESHOT) {
		return VALID_MODE.ONESHOT;
	}
	throw new Error(`Invalid mode '${mode}'. Use persistent or oneshot.`);
}

export function parseThreadMode({
	thread,
}: {
	thread?: string;
}): HarnessThreadMode {
	if (!thread || thread === VALID_THREAD_MODE.OFF) {
		return VALID_THREAD_MODE.OFF;
	}
	if (thread === VALID_THREAD_MODE.AUTO) {
		return VALID_THREAD_MODE.AUTO;
	}
	if (thread === VALID_THREAD_MODE.HERE) {
		return VALID_THREAD_MODE.HERE;
	}
	throw new Error(`Invalid thread mode '${thread}'. Use auto, here, or off.`);
}

export function parseTimeout({
	timeout,
}: {
	timeout?: string;
}): number | undefined {
	if (!timeout) {
		return undefined;
	}
	const parsed = Number.parseInt(timeout, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new Error("timeout must be a positive integer");
	}
	return parsed;
}

export function parsePositiveIntegerOption({
	value,
	flag,
}: {
	value: string | undefined;
	flag: string;
}): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer`);
	}
	return parsed;
}

export function parseNonNegativeIntegerOption({
	value,
	flag,
}: {
	value: string | undefined;
	flag: string;
}): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer`);
	}
	return parsed;
}

export function parseKeyValue({
	key,
	value,
}: {
	key: string;
	value: string;
}): string | number {
	if (key === "timeout") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			throw new Error("timeout must be a positive integer");
		}
		return parsed;
	}
	return value;
}

export function chooseProject({
	config,
	projectId,
}: {
	config: OrchestratorConfig;
	projectId?: string;
}): string {
	if (projectId) {
		if (!config.projects[projectId]) {
			throw new Error(`Unknown project '${projectId}'`);
		}
		return projectId;
	}

	const projectIds = Object.keys(config.projects);
	if (projectIds.length === 1) {
		return projectIds[0];
	}
	if (projectIds.length === 0) {
		throw new Error("No projects found in config");
	}
	throw new Error("Multiple projects found. Use --project <id> to choose one.");
}

export function buildPrompt({
	taskText,
	mode,
	runtimeOptions,
}: {
	taskText: string;
	mode: HarnessMode;
	runtimeOptions: HarnessRuntimeOptions;
}): string | undefined {
	const blocks: string[] = [];
	if (taskText) {
		blocks.push(taskText);
	}

	const runtimeHints: string[] = [];
	if (mode === VALID_MODE.ONESHOT) {
		runtimeHints.push("Run this as a one-shot task and stop when done.");
	}
	if (runtimeOptions.cwd) {
		runtimeHints.push(`Requested working directory: ${runtimeOptions.cwd}`);
	}
	if (runtimeOptions.model) {
		runtimeHints.push(`Preferred model: ${runtimeOptions.model}`);
	}
	if (runtimeOptions.permissions) {
		runtimeHints.push(
			`Preferred permissions profile: ${runtimeOptions.permissions}`
		);
	}
	if (runtimeOptions.timeout !== undefined) {
		runtimeHints.push(`Requested timeout: ${runtimeOptions.timeout} seconds`);
	}
	if (runtimeHints.length > 0) {
		blocks.push(runtimeHints.join("\n"));
	}

	if (blocks.length === 0) {
		return undefined;
	}
	return blocks.join("\n\n");
}

export function applySpawnOverrides({
	config,
	projectId,
	agentId,
	runtimeOptions,
}: {
	config: OrchestratorConfig;
	projectId: string;
	agentId: string;
	runtimeOptions: HarnessRuntimeOptions;
}): OrchestratorConfig {
	const project = config.projects[projectId];
	if (!project) {
		throw new Error(`Unknown project '${projectId}'`);
	}

	const nextAgentConfig = {
		...(project.agentConfig ?? {}),
	};
	if (
		runtimeOptions.permissions === "skip" ||
		runtimeOptions.permissions === "default"
	) {
		nextAgentConfig.permissions = runtimeOptions.permissions;
	}
	if (typeof runtimeOptions.model === "string") {
		nextAgentConfig.model = runtimeOptions.model;
	}

	return {
		...config,
		projects: {
			...config.projects,
			[projectId]: {
				...project,
				agent: agentId,
				agentConfig: nextAgentConfig,
			},
		},
	};
}

export function ensureAbsolutePath({
	cwd,
}: {
	cwd: string;
}): void {
	if (!isAbsolute(cwd)) {
		throw new Error("cwd must be an absolute path");
	}
}

export function parsePermissionValue({
	value,
}: {
	value: string;
}): string {
	if (!value.trim()) {
		throw new Error("permissions value cannot be empty");
	}
	return value.trim();
}

export function parseInstruction({
	parts,
}: {
	parts: string[];
}): string {
	const message = parts.join(" ").trim();
	if (!message) {
		throw new Error("instruction message is required");
	}
	return message;
}

export function parseTaskText({
	parts,
}: {
	parts: string[];
}): string {
	return parts.join(" ").trim();
}

export function resolveTeamRoot({
	root,
}: {
	root?: string;
}): string {
	return root ?? process.env.QAGENT_TEAM_ROOT ?? "~/.claude/teams";
}

export function parseRelayOutputMode({
	value,
}: {
	value: string | undefined;
}): RelayOutputMode {
	if (!value || value === RELAY_OUTPUT_MODE.PROTOCOL) {
		return RELAY_OUTPUT_MODE.PROTOCOL;
	}
	if (value === RELAY_OUTPUT_MODE.RAW) {
		return RELAY_OUTPUT_MODE.RAW;
	}
	throw new Error(
		`Invalid --output-mode '${value}'. Use '${RELAY_OUTPUT_MODE.PROTOCOL}' or '${RELAY_OUTPUT_MODE.RAW}'.`
	);
}
