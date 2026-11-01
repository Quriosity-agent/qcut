/**
 * The renderer half of N31: the export dialog builds its ASS here but cannot
 * read font files, so it asks the main process what libass will do with each
 * face and answers the generator synchronously from that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assFaceRequestsFor,
	loadAssFontMetrics,
	uncorrectedAssFontMetrics,
} from "../ass-font-metrics";

type ElectronApi = typeof window.electronAPI;
let original: ElectronApi;

function stubMetrics(assFontMetrics: (...args: unknown[]) => unknown): void {
	window.electronAPI = {
		...(original ?? {}),
		ffmpeg: { ...(original?.ffmpeg ?? {}), assFontMetrics },
	} as unknown as ElectronApi;
}

beforeEach(() => {
	original = window.electronAPI;
});

afterEach(() => {
	window.electronAPI = original;
});

describe("assFaceRequestsFor", () => {
	it("asks for every weight and slant of each family", () => {
		expect(assFaceRequestsFor(["Futura"])).toEqual([
			{ family: "Futura", bold: false, italic: false },
			{ family: "Futura", bold: false, italic: true },
			{ family: "Futura", bold: true, italic: false },
			{ family: "Futura", bold: true, italic: true },
		]);
	});

	it("drops blank names and asks for each family once", () => {
		const requests = assFaceRequestsFor(["Futura", " Futura ", "", "   "]);
		expect(requests).toHaveLength(4);
		expect(new Set(requests.map((request) => request.family))).toEqual(
			new Set(["Futura"])
		);
	});
});

describe("loadAssFontMetrics", () => {
	it("answers a measured face and leaves every other one unmeasured", async () => {
		stubMetrics(async () => [
			{
				family: "Helvetica",
				bold: false,
				italic: false,
				sizeFactor: 1.175,
				lineHeightEm: 1,
				coversCjk: false,
			},
		]);

		const { fontMetrics } = await loadAssFontMetrics(
			assFaceRequestsFor(["Helvetica"])
		);

		expect(
			fontMetrics({ family: "Helvetica", bold: false, italic: false })
		).toEqual({ sizeFactor: 1.175, lineHeightEm: 1 });
		// The bold face was asked for but not answered: unmeasured, never a
		// synthetic 1.0 — that would move the caption without resizing it.
		expect(
			fontMetrics({ family: "Helvetica", bold: true, italic: false })
		).toBeUndefined();
	});

	it("matches a face whatever its case or surrounding space", async () => {
		stubMetrics(async () => [
			{
				family: "Helvetica",
				bold: false,
				italic: false,
				sizeFactor: 1.175,
				lineHeightEm: 1,
				coversCjk: false,
			},
		]);

		const { fontMetrics } = await loadAssFontMetrics(
			assFaceRequestsFor(["Helvetica"])
		);
		expect(
			fontMetrics({ family: "  helvetica ", bold: false, italic: false })
		).toEqual({ sizeFactor: 1.175, lineHeightEm: 1 });
	});

	it("reports which families really carry CJK glyphs", async () => {
		stubMetrics(async () => [
			{
				family: "Source Han Serif CN",
				bold: false,
				italic: false,
				sizeFactor: 1.4,
				lineHeightEm: 1.4,
				coversCjk: true,
			},
		]);

		const { familyCoversCjk } = await loadAssFontMetrics(
			assFaceRequestsFor(["Source Han Serif CN", "Arial"])
		);

		expect(familyCoversCjk("Source Han Serif CN")).toBe(true);
		expect(familyCoversCjk("source han serif cn")).toBe(true);
		expect(familyCoversCjk("Arial")).toBe(false);
	});

	it("leaves everything unmeasured when the main process fails", async () => {
		// An export must not fail because a font could not be measured; an
		// uncorrected size is the old behaviour, not a broken one.
		stubMetrics(async () => {
			throw new Error("ipc unavailable");
		});

		const { fontMetrics, familyCoversCjk } = await loadAssFontMetrics(
			assFaceRequestsFor(["Helvetica"])
		);

		expect(
			fontMetrics({ family: "Helvetica", bold: false, italic: false })
		).toBeUndefined();
		expect(familyCoversCjk("Helvetica")).toBe(false);
	});

	it("does not call the main process with nothing to ask", async () => {
		const assFontMetrics = vi.fn(async () => []);
		stubMetrics(assFontMetrics);

		await loadAssFontMetrics([]);

		expect(assFontMetrics).not.toHaveBeenCalled();
	});

	it("works without a main process at all", async () => {
		window.electronAPI = undefined as unknown as ElectronApi;

		const { fontMetrics } = await loadAssFontMetrics(
			assFaceRequestsFor(["Helvetica"])
		);

		expect(
			fontMetrics({ family: "Helvetica", bold: false, italic: false })
		).toBeUndefined();
	});
});

describe("uncorrectedAssFontMetrics", () => {
	it("measures nothing, so the generator corrects nothing", () => {
		expect(
			uncorrectedAssFontMetrics({
				family: "Helvetica",
				bold: false,
				italic: false,
			})
		).toBeUndefined();
	});
});
