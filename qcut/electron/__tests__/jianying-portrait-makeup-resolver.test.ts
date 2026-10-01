// @vitest-environment node
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveJianyingPortraitMakeupCards } from "../jianying-portrait-adjustment-runtime/makeup-resolver.js";

const mocks = vi.hoisted(() => ({ access: vi.fn(), covers: vi.fn() }));
vi.mock("node:fs/promises", () => ({ access: mocks.access }));
vi.mock("../jianying-filter-local-runtime/private-runtime.js", () => ({
	jianyingFilterPrivateRuntimeCurrent: () => "/private/runtime",
}));
vi.mock("../jianying-portrait-adjustment-runtime/makeup-covers.js", () => ({
	resolveJianyingPortraitMakeupCovers: mocks.covers,
}));

describe("portrait makeup resolution separates covers from render packages", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.access.mockResolvedValue(undefined);
		mocks.covers.mockResolvedValue(
			new Map([["lip-coral-nude", "data:image/png;base64,cover"]])
		);
	});
	afterEach(() => vi.unstubAllEnvs());
	it("does not scan cover databases or fetch images on the render path", async () => {
		const cards = await resolveJianyingPortraitMakeupCards();
		expect(cards).toHaveLength(20);
		expect(cards.every(({ packagePath }) => packagePath !== null)).toBe(true);
		expect(mocks.covers).not.toHaveBeenCalled();
	});
	it("loads covers only for panel inspection and respects private-only mode", async () => {
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
		const cards = await resolveJianyingPortraitMakeupCards({
			includeThumbnails: true,
		});
		expect(
			cards.find(({ card }) => card.id === "lip-coral-nude")?.thumbnailDataUrl
		).toBe("data:image/png;base64,cover");
		expect(mocks.covers).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseRoots: [path.join("/private/runtime", "Cache", "ressdk_db")],
				cacheRoot: path.join(
					"/private/runtime",
					"Cache",
					"portrait-makeup-covers"
				),
			})
		);
	});
	it("does not request covers for unavailable effect packages", async () => {
		mocks.access.mockRejectedValue(new Error("not installed"));
		const cards = await resolveJianyingPortraitMakeupCards({
			includeThumbnails: true,
		});
		expect(cards.every(({ packagePath }) => packagePath === null)).toBe(true);
		expect(mocks.covers).toHaveBeenCalledWith(
			expect.objectContaining({ cards: [] })
		);
	});
});
