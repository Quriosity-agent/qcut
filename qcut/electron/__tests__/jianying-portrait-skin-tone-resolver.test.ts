// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../jianying-portrait-adjustment-runtime/skin-tone-catalog";
const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("node:fs/promises", () => ({ access: mocks.access }));
vi.mock("../jianying-filter-local-runtime/private-runtime.js", () => ({
	jianyingFilterPrivateRuntimeCurrent: () => "/private/runtime",
}));

describe("skin LUT package resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.access.mockResolvedValue(undefined);
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "0");
	});
	afterEach(() => vi.unstubAllEnvs());
	it.each(
		JIANYING_PORTRAIT_SKIN_TONES
	)("resolves $titleEn through its exact allowlisted identity", async ({
		resourceId,
		version,
	}) => {
		const result = await resolveJianyingPortraitPackage({
			runtimePackage: "skin-tone",
			skinToneResourceId: resourceId,
		});
		expect(result.skinToneResourceId).toBe(resourceId);
		expect(result.source).toBe("qcut-private");
		expect(result.packagePath).toBe(
			`/private/runtime/Cache/effect/${resourceId}/${resourceId === "7408757645705760000" ? "c36221f2a2097535ce1a2f70cd9e0116" : version}`
		);
		expect(
			mocks.access.mock.calls.some(([name]) =>
				name.endsWith("/AmazingFeature/image/filter_skin.png")
			)
		).toBe(true);
	});
	it("allows the verified installed pink version only for explicit selection, not legacy fallback", async () => {
		mocks.access.mockImplementation(async (name: string) => {
			if (
				name.startsWith("/private") ||
				!name.includes("74cd555080d70f9ccf3a1133a65f9f8d")
			)
				throw new Error("missing");
		});
		expect(
			(await resolveJianyingPortraitPackage({ runtimePackage: "skin-tone" }))
				.packagePath
		).toBeNull();
		expect(
			await resolveJianyingPortraitPackage({
				runtimePackage: "skin-tone",
				skinToneResourceId: "7408757645705760000",
			})
		).toMatchObject({
			source: "jianying-installation",
			packagePath: expect.stringContaining("74cd555080d70f9ccf3a1133a65f9f8d"),
		});
	});
	it("honors private-only mode and cannot substitute another swatch", async () => {
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
		mocks.access.mockImplementation(async (name: string) => {
			if (name.includes("7408757645705743616")) throw new Error("missing");
		});
		expect(
			await resolveJianyingPortraitPackage({
				runtimePackage: "skin-tone",
				skinToneResourceId: "7408757645705743616",
			})
		).toMatchObject({ packagePath: null, source: "none" });
		expect(
			mocks.access.mock.calls.every(([name]) =>
				name.startsWith("/private/runtime/")
			)
		).toBe(true);
	});
	it("does not report readiness for an incomplete LUT package", async () => {
		mocks.access.mockImplementation(async (name: string) => {
			if (name.endsWith("/temperature_min.png")) throw new Error("missing LUT");
		});
		expect(
			(
				await resolveJianyingPortraitPackage({
					runtimePackage: "skin-tone",
					skinToneResourceId: "7408757645705776384",
				})
			).packagePath
		).toBeNull();
	});
});
