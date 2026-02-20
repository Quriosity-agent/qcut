/**
 * Configuration Loader
 *
 * Loads pipeline configurations from YAML/JSON files with
 * environment variable interpolation and config merging.
 *
 * Ported from: utils/config_loader.py
 *
 * @module electron/native-pipeline/config-loader
 */

import * as fs from "fs";
import * as path from "path";
import { ConfigurationError } from "./errors.js";

/**
 * Deep merge two objects. Override values take precedence.
 * Arrays are replaced, not concatenated.
 */
export function mergeConfigs(
	base: Record<string, unknown>,
	override: Record<string, unknown>
): Record<string, unknown> {
	const result = { ...base };

	for (const [key, value] of Object.entries(override)) {
		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			typeof result[key] === "object" &&
			result[key] !== null &&
			!Array.isArray(result[key])
		) {
			result[key] = mergeConfigs(
				result[key] as Record<string, unknown>,
				value as Record<string, unknown>
			);
		} else {
			result[key] = value;
		}
	}

	return result;
}

/**
 * Replace ${VAR_NAME} or $VAR_NAME patterns with environment variable values.
 * Supports default values with ${VAR_NAME:-default} syntax.
 */
export function processEnvironmentVariables(
	config: Record<string, unknown>
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		if (typeof value === "string") {
			result[key] = interpolateEnvVars(value);
		} else if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			result[key] = processEnvironmentVariables(
				value as Record<string, unknown>
			);
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) => {
				if (typeof item === "string") return interpolateEnvVars(item);
				if (typeof item === "object" && item !== null) {
					return processEnvironmentVariables(item as Record<string, unknown>);
				}
				return item;
			});
		} else {
			result[key] = value;
		}
	}

	return result;
}

function interpolateEnvVars(text: string): string {
	// Match ${VAR_NAME} or ${VAR_NAME:-default}
	return text
		.replace(
			/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g,
			(_match, varName: string, defaultValue?: string) => {
				const envValue = process.env[varName];
				if (envValue !== undefined) return envValue;
				if (defaultValue !== undefined) return defaultValue;
				return "";
			}
		)
		.replace(
			// Match $VAR_NAME (without braces, no default support)
			/\$([A-Za-z_][A-Za-z0-9_]*)/g,
			(_match, varName: string) => {
				return process.env[varName] ?? "";
			}
		);
}

/**
 * Load a .env file and set variables in process.env.
 * Skips comments and empty lines.
 */
export function loadEnvironmentConfig(envFile: string): Record<string, string> {
	if (!fs.existsSync(envFile)) {
		throw new ConfigurationError(`Environment file not found: ${envFile}`);
	}

	const content = fs.readFileSync(envFile, "utf-8");
	const vars: Record<string, string> = {};

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;

		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();

		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		vars[key] = value;
		process.env[key] = value;
	}

	return vars;
}

/**
 * Load a JSON config file with environment variable processing.
 */
export function loadJsonConfig(configPath: string): Record<string, unknown> {
	const resolved = path.resolve(configPath);
	if (!fs.existsSync(resolved)) {
		throw new ConfigurationError(`Config file not found: ${configPath}`);
	}

	try {
		const content = fs.readFileSync(resolved, "utf-8");
		const raw = JSON.parse(content) as Record<string, unknown>;
		return processEnvironmentVariables(raw);
	} catch (err) {
		if (err instanceof ConfigurationError) throw err;
		throw new ConfigurationError(
			`Failed to parse config ${configPath}: ${err instanceof Error ? err.message : String(err)}`
		);
	}
}

/**
 * Save config to JSON file.
 */
export function saveJsonConfig(
	config: Record<string, unknown>,
	outputPath: string
): string {
	const resolved = path.resolve(outputPath);
	const dir = path.dirname(resolved);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(resolved, JSON.stringify(config, null, 2), "utf-8");
	return resolved;
}
