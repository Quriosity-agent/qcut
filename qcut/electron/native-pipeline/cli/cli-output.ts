/**
 * Structured CLI output with JSON envelope, table formatting, and ANSI colors.
 *
 * Routes output based on mode flags (json, quiet, debug).
 * Provides consistent formatting for human-readable and machine-readable output.
 *
 * Ported from: cli/output.py
 *
 * @module electron/native-pipeline/cli-output
 */

const SCHEMA_VERSION = "1";

// -- ANSI Color Helpers --

const SUPPORTS_COLOR =
	process.env.NO_COLOR === undefined &&
	process.env.FORCE_COLOR !== "0" &&
	(process.stderr.isTTY ?? false);

export const ansi = {
	reset: SUPPORTS_COLOR ? "\x1b[0m" : "",
	bold: SUPPORTS_COLOR ? "\x1b[1m" : "",
	dim: SUPPORTS_COLOR ? "\x1b[2m" : "",
	red: SUPPORTS_COLOR ? "\x1b[31m" : "",
	green: SUPPORTS_COLOR ? "\x1b[32m" : "",
	yellow: SUPPORTS_COLOR ? "\x1b[33m" : "",
	blue: SUPPORTS_COLOR ? "\x1b[34m" : "",
	cyan: SUPPORTS_COLOR ? "\x1b[36m" : "",
} as const;

export function colorize(text: string, color: keyof typeof ansi): string {
	if (!SUPPORTS_COLOR) return text;
	return `${ansi[color]}${text}${ansi.reset}`;
}

// -- Table Formatting --

export interface TableColumn {
	header: string;
	width?: number;
	align?: "left" | "right";
}

export function formatTable(
	rows: Record<string, unknown>[],
	columns?: TableColumn[]
): string {
	if (rows.length === 0) return "";

	const keys = columns ? columns.map((c) => c.header) : Object.keys(rows[0]);

	// Calculate column widths
	const widths: number[] = keys.map((key) => {
		const maxDataWidth = rows.reduce((max, row) => {
			const val = String(row[key] ?? "");
			return Math.max(max, val.length);
		}, 0);
		const col = columns?.find((c) => c.header === key);
		return col?.width ?? Math.max(key.length, maxDataWidth);
	});

	// Header row
	const header = keys.map((key, i) => key.padEnd(widths[i])).join("  ");

	const separator = widths.map((w) => "-".repeat(w)).join("  ");

	// Data rows
	const dataRows = rows.map((row) =>
		keys
			.map((key, i) => {
				const val = String(row[key] ?? "");
				const col = columns?.find((c) => c.header === key);
				return col?.align === "right"
					? val.padStart(widths[i])
					: val.padEnd(widths[i]);
			})
			.join("  ")
	);

	return [header, separator, ...dataRows].join("\n");
}

// -- JSON Envelope --

export interface JsonEnvelope {
	schema_version: string;
	command: string;
	data?: unknown;
	items?: unknown[];
	count?: number;
}

function createEnvelope(
	command: string,
	data?: unknown,
	items?: unknown[]
): JsonEnvelope {
	const envelope: JsonEnvelope = {
		schema_version: SCHEMA_VERSION,
		command,
	};
	if (data !== undefined) envelope.data = data;
	if (items !== undefined) {
		envelope.items = items;
		envelope.count = items.length;
	}
	return envelope;
}

// -- CLIOutput Class --

export interface CLIOutputOptions {
	jsonMode?: boolean;
	quiet?: boolean;
	debug?: boolean;
}

export class CLIOutput {
	readonly jsonMode: boolean;
	readonly quiet: boolean;
	readonly debug: boolean;

	constructor(options: CLIOutputOptions = {}) {
		this.jsonMode = options.jsonMode ?? false;
		this.quiet = options.quiet ?? false;
		this.debug = options.debug ?? false;
	}

	/** Print informational message (suppressed in json/quiet mode). */
	info(message: string): void {
		if (this.jsonMode || this.quiet) return;
		console.log(message);
	}

	/** Print error to stderr (always visible). */
	error(message: string): void {
		console.error(colorize(`error: ${message}`, "red"));
	}

	/** Print warning to stderr. */
	warning(message: string): void {
		if (this.quiet) return;
		console.error(colorize(`warning: ${message}`, "yellow"));
	}

	/** Print debug message (debug mode only). */
	verbose(message: string): void {
		if (!this.debug) return;
		console.error(colorize(message, "dim"));
	}

	/** Print success message with green checkmark. */
	success(message: string): void {
		if (this.jsonMode || this.quiet) return;
		console.log(colorize(`✓ ${message}`, "green"));
	}

	/** Print step indicator with blue arrow. */
	step(message: string): void {
		if (this.jsonMode || this.quiet) return;
		console.log(`${colorize("→", "blue")} ${message}`);
	}

	/** Print cost information. */
	cost(amount: number, currency = "USD"): void {
		if (this.jsonMode || this.quiet) return;
		console.log(colorize(`  Cost: $${amount.toFixed(4)} ${currency}`, "dim"));
	}

	/** Emit final result as JSON envelope or human-readable format. */
	result(data: Record<string, unknown>, command?: string): void {
		if (this.jsonMode) {
			const envelope = createEnvelope(command ?? "result", data);
			console.log(JSON.stringify(envelope, null, 2));
		} else if (!this.quiet) {
			for (const [key, value] of Object.entries(data)) {
				console.log(
					`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`
				);
			}
		}
	}

	/** Emit tabular data as JSON array or formatted table. */
	table(
		rows: Record<string, unknown>[],
		headers?: TableColumn[],
		command?: string
	): void {
		if (this.jsonMode) {
			const envelope = createEnvelope(command ?? "table", undefined, rows);
			console.log(JSON.stringify(envelope, null, 2));
		} else if (!this.quiet) {
			console.log(formatTable(rows, headers));
		}
	}
}
