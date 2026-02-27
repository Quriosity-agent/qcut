/**
 * Server-side session label store.
 *
 * Persists user-assigned labels for sessions (managed or unmanaged)
 * in a JSON file at ~/.qagent/session-labels.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DashboardSession } from "./types.js";

const LABELS_DIR = join(homedir(), ".qagent");
const LABELS_FILE = join(LABELS_DIR, "session-labels.json");

type LabelMap = Record<string, string>;

function readLabels(): LabelMap {
	try {
		return JSON.parse(readFileSync(LABELS_FILE, "utf-8")) as LabelMap;
	} catch {
		return {};
	}
}

function writeLabels(labels: LabelMap): void {
	mkdirSync(LABELS_DIR, { recursive: true });
	writeFileSync(LABELS_FILE, JSON.stringify(labels, null, "\t") + "\n");
}

/** Get the label for a session, or null if none set. */
export function getLabel(sessionId: string): string | null {
	return readLabels()[sessionId] ?? null;
}

/** Set or clear a label for a session. */
export function setLabel(sessionId: string, label: string | null): void {
	const labels = readLabels();
	if (label) {
		labels[sessionId] = label;
	} else {
		delete labels[sessionId];
	}
	writeLabels(labels);
}

/** Apply stored labels to an array of dashboard sessions (mutates in place). */
export function applyLabels(sessions: DashboardSession[]): void {
	const labels = readLabels();
	if (Object.keys(labels).length === 0) return;
	for (const s of sessions) {
		const label = labels[s.id];
		if (label) {
			s.label = label;
		}
	}
}
