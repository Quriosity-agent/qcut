/**
 * Server-side session label store.
 *
 * Persists user-assigned labels for sessions (managed or unmanaged)
 * in a JSON file at ~/.qagent/session-labels.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DashboardSession } from "./types.js";

const LABELS_DIR = join(homedir(), ".qagent");
const LABELS_FILE = join(LABELS_DIR, "session-labels.json");

type LabelMap = Record<string, string>;

/** Read the session labels map from disk, returning empty object on error. */
async function readLabels(): Promise<LabelMap> {
	try {
		return JSON.parse(await readFile(LABELS_FILE, "utf-8")) as LabelMap;
	} catch {
		return {};
	}
}

/** Persist the session labels map to disk, creating the directory if needed. */
async function writeLabels(labels: LabelMap): Promise<void> {
	await mkdir(LABELS_DIR, { recursive: true });
	await writeFile(LABELS_FILE, JSON.stringify(labels, null, "\t") + "\n");
}

/** Get the label for a session, or null if none set. */
export async function getLabel(sessionId: string): Promise<string | null> {
	const labels = await readLabels();
	return labels[sessionId] ?? null;
}

/** Set or clear a label for a session. */
export async function setLabel(
	sessionId: string,
	label: string | null,
): Promise<void> {
	const labels = await readLabels();
	if (label) {
		labels[sessionId] = label;
	} else {
		delete labels[sessionId];
	}
	await writeLabels(labels);
}

/** Apply stored labels to an array of dashboard sessions (mutates in place). */
export async function applyLabels(
	sessions: DashboardSession[],
): Promise<void> {
	const labels = await readLabels();
	if (Object.keys(labels).length === 0) return;
	for (const s of sessions) {
		if (Object.hasOwn(labels, s.id)) {
			s.label = labels[s.id];
		}
	}
}
