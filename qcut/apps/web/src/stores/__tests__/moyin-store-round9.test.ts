/**
 * Tests for Round 9: undo/redo, JSON export/import, episode navigation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
	pushUndo,
	popUndo,
	popRedo,
	canUndo,
	canRedo,
	clearUndoHistory,
	getStackSizes,
} from "../moyin/moyin-undo";
import type { UndoEntry } from "../moyin/moyin-undo";
import {
	exportProjectJSON,
	parseImportedProjectJSON,
	partializeMoyinState,
} from "../moyin/moyin-persistence";
import type { MoyinPersistedState } from "../moyin/moyin-persistence";

function makeEntry(label: string): UndoEntry {
	return {
		characters: [
			{
				id: label,
				name: label,
				role: "lead",
				appearance: "",
				personality: "",
			},
		],
		scenes: [],
		shots: [],
	};
}

const currentEntry = makeEntry("current");

describe("moyin-undo", () => {
	beforeEach(() => {
		clearUndoHistory();
	});

	it("starts with empty stacks", () => {
		expect(canUndo()).toBe(false);
		expect(canRedo()).toBe(false);
		expect(getStackSizes()).toEqual({ undo: 0, redo: 0 });
	});

	it("pushUndo adds to undo stack", () => {
		pushUndo(makeEntry("a"));
		expect(canUndo()).toBe(true);
		expect(getStackSizes().undo).toBe(1);
	});

	it("pushUndo clears redo stack", () => {
		pushUndo(makeEntry("a"));
		popUndo(currentEntry); // moves to redo
		expect(canRedo()).toBe(true);
		pushUndo(makeEntry("b")); // should clear redo
		expect(canRedo()).toBe(false);
	});

	it("popUndo returns last entry and moves current to redo", () => {
		const a = makeEntry("a");
		pushUndo(a);
		const result = popUndo(currentEntry);
		expect(result).toEqual(a);
		expect(canUndo()).toBe(false);
		expect(canRedo()).toBe(true);
	});

	it("popUndo returns null when empty", () => {
		expect(popUndo(currentEntry)).toBeNull();
	});

	it("popRedo returns entry and pushes current to undo", () => {
		pushUndo(makeEntry("a"));
		popUndo(currentEntry); // a in redo
		const result = popRedo(makeEntry("b"));
		expect(result).not.toBeNull();
		expect(result!.characters[0].id).toBe("current");
		expect(canUndo()).toBe(true);
		expect(canRedo()).toBe(false);
	});

	it("popRedo returns null when empty", () => {
		expect(popRedo(currentEntry)).toBeNull();
	});

	it("respects MAX_STACK of 20", () => {
		for (let i = 0; i < 25; i++) {
			pushUndo(makeEntry(`entry-${i}`));
		}
		expect(getStackSizes().undo).toBe(20);
	});

	it("clearUndoHistory resets both stacks", () => {
		pushUndo(makeEntry("a"));
		pushUndo(makeEntry("b"));
		popUndo(currentEntry);
		clearUndoHistory();
		expect(getStackSizes()).toEqual({ undo: 0, redo: 0 });
	});
});

describe("moyin-persistence: JSON export/import", () => {
	const sampleState: MoyinPersistedState = {
		rawScript: "test script",
		scriptData: null,
		parseStatus: "ready",
		characters: [
			{
				id: "c1",
				name: "Alice",
				role: "lead",
				appearance: "",
				personality: "",
			},
		],
		scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
		shots: [
			{
				id: "sh1",
				index: 0,
				sceneRefId: "s1",
				actionSummary: "Walk",
				characterIds: [],
				characterVariations: {},
				imageStatus: "idle",
				imageProgress: 0,
				videoStatus: "idle",
				videoProgress: 0,
			},
		],
		episodes: [{ id: "ep1", index: 0, title: "Episode 1", sceneIds: ["s1"] }],
		selectedStyleId: "2d_ghibli",
		selectedProfileId: "classic-cinematic",
		language: "English",
		sceneCount: "auto",
		shotCount: "auto",
	};

	it("parseImportedProjectJSON round-trips valid data", () => {
		const envelope = JSON.stringify({ version: 1, data: sampleState });
		const result = parseImportedProjectJSON(envelope);
		expect(result).not.toBeNull();
		expect(result!.characters).toHaveLength(1);
		expect(result!.characters[0].name).toBe("Alice");
		expect(result!.scenes).toHaveLength(1);
		expect(result!.shots).toHaveLength(1);
	});

	it("parseImportedProjectJSON returns null for invalid JSON", () => {
		expect(parseImportedProjectJSON("not json")).toBeNull();
	});

	it("parseImportedProjectJSON returns null for missing version", () => {
		const bad = JSON.stringify({ data: sampleState });
		expect(parseImportedProjectJSON(bad)).toBeNull();
	});

	it("parseImportedProjectJSON returns null for missing arrays", () => {
		const bad = JSON.stringify({
			version: 1,
			data: { ...sampleState, characters: "not array" },
		});
		expect(parseImportedProjectJSON(bad)).toBeNull();
	});

	it("partializeMoyinState extracts correct fields", () => {
		const fullState = {
			...sampleState,
			projectId: "proj-1",
			activeStep: "script" as const,
			generationStatus: "idle" as const,
		};
		const partial = partializeMoyinState(fullState);
		expect(partial.rawScript).toBe("test script");
		expect(partial.characters).toHaveLength(1);
		expect(
			(partial as unknown as Record<string, unknown>).projectId
		).toBeUndefined();
		expect(
			(partial as unknown as Record<string, unknown>).activeStep
		).toBeUndefined();
	});
});
