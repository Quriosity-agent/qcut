/**
 * Lightweight undo/redo stack for Moyin store mutations.
 * Stores partial state snapshots (characters, scenes, shots) to minimize memory.
 * Not persisted — only lives in memory for the current session.
 */

import type { ScriptCharacter, ScriptScene, Shot } from "@/types/moyin-script";

export interface UndoEntry {
	characters: ScriptCharacter[];
	scenes: ScriptScene[];
	shots: Shot[];
}

const MAX_STACK = 20;

let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];

/** Push a snapshot before a mutation. Clears redo stack. */
export function pushUndo(entry: UndoEntry): void {
	undoStack.push(entry);
	if (undoStack.length > MAX_STACK) undoStack.shift();
	redoStack = [];
}

/** Pop the last undo entry and push current state to redo. Returns null if empty. */
export function popUndo(current: UndoEntry): UndoEntry | null {
	const entry = undoStack.pop();
	if (!entry) return null;
	redoStack.push(current);
	return entry;
}

/** Pop from redo stack and push current to undo. Returns null if empty. */
export function popRedo(current: UndoEntry): UndoEntry | null {
	const entry = redoStack.pop();
	if (!entry) return null;
	undoStack.push(current);
	return entry;
}

export function canUndo(): boolean {
	return undoStack.length > 0;
}

export function canRedo(): boolean {
	return redoStack.length > 0;
}

export function clearUndoHistory(): void {
	undoStack = [];
	redoStack = [];
}

/** Get stack sizes (for testing). */
export function getStackSizes(): { undo: number; redo: number } {
	return { undo: undoStack.length, redo: redoStack.length };
}
