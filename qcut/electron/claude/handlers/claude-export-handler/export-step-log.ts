/**
 * What the FFmpeg steps of one export leave for its report: the commands
 * they ran, and the filter graphs FFmpeg rebuilt part-way through a step.
 *
 * Every step of a job carries the job's cancellation signal, so that is what
 * a job's log is filed under; a step run without one, or for a job that
 * opened no log, leaves nothing.
 *
 * @module electron/claude/handlers/claude-export-handler/export-step-log
 */

import path from "node:path";

export interface ExportStepLog {
	/** Each FFmpeg step's arguments, in the order the steps started. */
	commands: string[][];
	/** Steps whose filter graph FFmpeg rebuilt while they ran. */
	rebuilds: Array<{ args: string[]; reasons: string[] }>;
}

const logs = new WeakMap<AbortSignal, ExportStepLog>();

/** Starts the log of the job `signal` belongs to. */
export function openExportStepLog({
	signal,
}: {
	signal: AbortSignal;
}): ExportStepLog {
	const log: ExportStepLog = { commands: [], rebuilds: [] };
	logs.set(signal, log);
	return log;
}

export function exportStepLogFor({
	signal,
}: {
	signal?: AbortSignal;
}): ExportStepLog | undefined {
	return signal ? logs.get(signal) : undefined;
}

/**
 * FFmpeg's own words for each time it rebuilt a filter graph in `stderr`
 * ("video parameters changed to yuv420p(tv, bt709), 1470x630, …"). It does
 * so when an input's picture or sound changes format part-way, and every
 * other input of that graph loses the frames the old graph had read ahead.
 */
export function graphRebuildReasons({ stderr }: { stderr: string }): string[] {
	const reasons = new Set<string>();
	for (const match of stderr.matchAll(
		/Reconfiguring filter graph because ([^\r\n]+)/g
	)) {
		reasons.add(match[1].trim());
	}
	return [...reasons];
}

function inputPaths({ args }: { args: string[] }): string[] {
	return args.flatMap((arg, index) =>
		arg === "-i" && index + 1 < args.length ? [args[index + 1]] : []
	);
}

/**
 * One warning per step whose graph was rebuilt while it read more than one
 * input: there the rebuild loses frames. A step with a single input starts
 * its graph again with nothing read ahead, and is left out.
 */
export function graphRebuildWarnings({
	log,
}: {
	log: ExportStepLog;
}): string[] {
	return log.rebuilds.flatMap(({ args, reasons }) => {
		const inputs = inputPaths({ args });
		if (inputs.length < 2) return [];
		return [
			`FFmpeg rebuilt a filter graph while it read ${path.basename(inputs[0])} with ${inputs.length - 1} other input(s) (${reasons.join("; ")}). The frames it had read ahead from them are lost at that point, so what is drawn or mixed over that input can start a few frames into itself there.`,
		];
	});
}

function shellQuote(value: string): string {
	return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
		? value
		: `'${value.replace(/'/g, "'\\''")}'`;
}

/** Arguments as one shell line, quoted where a shell would split them. */
export function formatShellArgs({ args }: { args: string[] }): string {
	return args.map(shellQuote).join(" ");
}

/** The steps as a shell script, one command a line, to run them again. */
export function exportStepScript({
	log,
	ffmpegPath,
}: {
	log: ExportStepLog;
	ffmpegPath: string;
}): string {
	return [
		"#!/bin/sh",
		"# The FFmpeg commands of this export, in the order they ran.",
		...log.commands.map((args) =>
			formatShellArgs({ args: [ffmpegPath, ...args] })
		),
		"",
	].join("\n");
}
