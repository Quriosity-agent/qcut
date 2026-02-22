/**
 * Tests for Round 8: reorder, multi-select, and keyboard helper actions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { reorderShotsAction, reorderScenesAction } from "../moyin-generation";
import type { Shot, Episode } from "@/types/moyin-script";

function makeShot(id: string, sceneRefId: string, index: number): Shot {
	return {
		id,
		sceneRefId,
		index,
		actionSummary: `Shot ${id}`,
		characterIds: [],
		characterVariations: {},
		imageStatus: "idle",
		imageProgress: 0,
		videoStatus: "idle",
		videoProgress: 0,
	};
}

function makeEpisode(id: string, sceneIds: string[], index = 0): Episode {
	return { id, index, title: `Episode ${id}`, sceneIds };
}

describe("reorderShotsAction", () => {
	const shots: Shot[] = [
		makeShot("s1", "sc1", 0),
		makeShot("s2", "sc1", 1),
		makeShot("s3", "sc1", 2),
		makeShot("s4", "sc2", 0), // different scene
	];

	it("moves a shot forward within its scene", () => {
		const result = reorderShotsAction("s1", 2, shots);
		const sceneShots = result.filter((s) => s.sceneRefId === "sc1");
		expect(sceneShots.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
	});

	it("moves a shot backward within its scene", () => {
		const result = reorderShotsAction("s3", 0, shots);
		const sceneShots = result.filter((s) => s.sceneRefId === "sc1");
		expect(sceneShots.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
	});

	it("re-indexes shots after reorder", () => {
		const result = reorderShotsAction("s3", 0, shots);
		const sceneShots = result.filter((s) => s.sceneRefId === "sc1");
		expect(sceneShots.map((s) => s.index)).toEqual([0, 1, 2]);
	});

	it("does not affect shots in other scenes", () => {
		const result = reorderShotsAction("s1", 2, shots);
		const otherShots = result.filter((s) => s.sceneRefId === "sc2");
		expect(otherShots).toHaveLength(1);
		expect(otherShots[0].id).toBe("s4");
	});

	it("returns original array when shotId not found", () => {
		const result = reorderShotsAction("nonexistent", 0, shots);
		expect(result).toBe(shots);
	});

	it("clamps target index to valid range", () => {
		const result = reorderShotsAction("s1", 100, shots);
		const sceneShots = result.filter((s) => s.sceneRefId === "sc1");
		expect(sceneShots[sceneShots.length - 1].id).toBe("s1");
	});
});

describe("reorderScenesAction", () => {
	const episodes: Episode[] = [
		makeEpisode("ep1", ["sc1", "sc2", "sc3"]),
		makeEpisode("ep2", ["sc4", "sc5"]),
	];

	it("moves a scene forward in the episode", () => {
		const result = reorderScenesAction("ep1", "sc1", 2, episodes);
		const ep = result.find((e) => e.id === "ep1")!;
		expect(ep.sceneIds).toEqual(["sc2", "sc3", "sc1"]);
	});

	it("moves a scene backward in the episode", () => {
		const result = reorderScenesAction("ep1", "sc3", 0, episodes);
		const ep = result.find((e) => e.id === "ep1")!;
		expect(ep.sceneIds).toEqual(["sc3", "sc1", "sc2"]);
	});

	it("does not affect other episodes", () => {
		const result = reorderScenesAction("ep1", "sc1", 2, episodes);
		const ep2 = result.find((e) => e.id === "ep2")!;
		expect(ep2.sceneIds).toEqual(["sc4", "sc5"]);
	});

	it("returns original array when episode not found", () => {
		const result = reorderScenesAction("nonexistent", "sc1", 0, episodes);
		expect(result).toBe(episodes);
	});
});
