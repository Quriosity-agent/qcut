/**
 * Editor API Types
 *
 * TypeScript interfaces for editor CLI commands and common
 * response shapes from the QCut HTTP API.
 *
 * @module electron/native-pipeline/editor-api-types
 */

import * as fs from "fs";
import { readStdin } from "./interactive.js";

// ---------------------------------------------------------------------------
// Editor-specific CLI option fields
// (These are added to CLIRunOptions via the parseArgs extension in cli.ts)
// ---------------------------------------------------------------------------

export interface EditorOptions {
	projectId?: string;
	mediaId?: string;
	elementId?: string;
	jobId?: string;
	trackId?: string;
	toTrack?: string;
	splitTime?: number;
	startTime?: number;
	endTime?: number;
	newName?: string;
	changes?: string;
	updates?: string;
	elements?: string;
	cuts?: string;
	items?: string;
	target?: string;
	preset?: string;
	threshold?: number;
	timestamps?: string;
	host?: string;
	port?: string;
	token?: string;
	poll?: boolean;
	pollInterval?: number;
	replace?: boolean;
	ripple?: boolean;
	crossTrackRipple?: boolean;
	removeFillers?: boolean;
	removeSilences?: boolean;
	html?: string;
	message?: string;
	stack?: string;
	addToTimeline?: boolean;
	includeFillers?: boolean;
	includeSilences?: boolean;
	includeScenes?: boolean;
	clearLog?: boolean;
	toolName?: string;
}

// ---------------------------------------------------------------------------
// Common API response types
// ---------------------------------------------------------------------------

export interface MediaFile {
	id: string;
	name: string;
	type: string;
	path: string;
	size: number;
	duration?: number;
}

export interface ProjectSettings {
	name: string;
	width: number;
	height: number;
	fps: number;
	aspectRatio?: string;
	backgroundColor?: string;
	exportFormat?: string;
	exportQuality?: string;
}

export interface ProjectStats {
	totalDuration: number;
	mediaCount: { video: number; audio: number; image: number };
	trackCount: number;
	elementCount: number;
	lastModified?: number;
	fileSize?: number;
}

export interface AsyncJobStatus {
	jobId: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	progress?: number;
	message?: string;
	result?: unknown;
	createdAt?: number;
	updatedAt?: number;
}

// ---------------------------------------------------------------------------
// JSON input resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a JSON input value from CLI flags.
 *
 * Supports three input modes:
 * - `@file.json` — read and parse a JSON file
 * - `{...}` or `[...]` — parse as inline JSON
 * - `-` — read JSON from stdin
 *
 * @throws Error if the input cannot be parsed as valid JSON
 */
export async function resolveJsonInput(value: string): Promise<unknown> {
	let raw: string;

	if (value === "-") {
		raw = await readStdin();
	} else if (value.startsWith("@")) {
		const filePath = value.slice(1);
		try {
			raw = fs.readFileSync(filePath, "utf-8");
		} catch (err) {
			throw new Error(
				`Cannot read file: ${filePath} — ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	} else {
		raw = value;
	}

	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(
			`Invalid JSON input. Use inline JSON, @file.json, or - for stdin.`,
		);
	}
}
