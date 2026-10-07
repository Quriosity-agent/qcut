import { describe, expect, it } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../../../../../../electron/jianying-portrait-adjustment-runtime/makeup-catalog";
import { beautyLabCatalogStatus } from "../beauty-lab-catalog";

describe("Beauty Lab full draft catalog", () => {
	it("keeps skin tone on the editor's two numeric controls without inventing palette presets", () => {
		const status = beautyLabCatalogStatus({ status: null });
		expect(
			status.catalog
				.filter(({ runtimePackage }) => runtimePackage === "skin-tone")
				.map(({ key, min, max, step }) => ({ key, min, max, step }))
		).toEqual([
			{ key: "face_adjust_skin_Intensity", min: 0, max: 100, step: 1 },
			{ key: "face_adjust_skin_ColdWarm", min: -50, max: 50, step: 1 },
		]);
		expect(status.available).toBe(false);
		expect(status.offlineReady).toBe(false);
	});

	it("shows the real complete catalog without claiming native readiness", () => {
		const status = beautyLabCatalogStatus({ status: null });
		expect(status.available).toBe(false);
		expect(status.offlineReady).toBe(false);
		expect(status.catalog).toEqual(JIANYING_PORTRAIT_ADJUSTMENT_CATALOG);
		expect(status.makeupCards.map(({ id }) => id)).toEqual(
			JIANYING_PORTRAIT_MAKEUP_CARDS.map(({ id }) => id)
		);
		expect(
			status.makeupCards.every(
				({ ready, source }) => !ready && source === "none"
			)
		).toBe(true);
	});
	it("preserves installed thumbnails and readiness without removing missing cards", () => {
		const base = beautyLabCatalogStatus({ status: null });
		const card = {
			...base.makeupCards[0],
			ready: true,
			source: "qcut-private" as const,
			thumbnailDataUrl: "data:image/png;base64,test",
		};
		const status = beautyLabCatalogStatus({
			status: {
				...base,
				available: true,
				state: "ready",
				catalog: [],
				makeupCards: [card],
			},
		});
		expect(status.available).toBe(true);
		expect(status.catalog).toHaveLength(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.length
		);
		expect(status.makeupCards[0]).toBe(card);
		expect(status.makeupCards[1].ready).toBe(false);
	});
	it("represents out-of-product probe values only in an explicit record view", () => {
		const regular = beautyLabCatalogStatus({ status: null });
		const recorded = beautyLabCatalogStatus({
			status: null,
			recordedValues: { face_adjust_eye: 100 },
		});
		expect(
			regular.catalog.find(({ key }) => key === "face_adjust_eye")?.max
		).toBe(50);
		expect(
			recorded.catalog.find(({ key }) => key === "face_adjust_eye")?.max
		).toBe(100);
		expect(beautyLabCatalogStatus({ status: null }).catalog).toEqual(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG
		);
		expect(recorded.available).toBe(false);
	});
});

describe("independent draft catalog availability", () => {
	const capability = {
		available: true,
		provider: "qcut-independent-photo-v1" as const,
		message: "test",
		controls: [],
		makeupCards: [JIANYING_PORTRAIT_MAKEUP_CARDS[0].id],
	};
	it("allows independent makeup selection without claiming native readiness", () => {
		const status = beautyLabCatalogStatus({
			status: null,
			independentStatus: capability,
		});
		expect(status.available).toBe(false);
		expect(status.offlineReady).toBe(false);
		expect(status.makeupCards[0]).toMatchObject({
			ready: true,
			source: "none",
		});
		expect(status.makeupCards.slice(1).every(({ ready }) => !ready)).toBe(true);
	});
	it("does not enable independent cards when its runtime is unavailable", () => {
		const status = beautyLabCatalogStatus({
			status: null,
			independentStatus: { ...capability, available: false },
		});
		expect(status.makeupCards.every(({ ready }) => !ready)).toBe(true);
	});
	it("keeps native capability immutable when independent selection enables a card", () => {
		const native = beautyLabCatalogStatus({ status: null });
		const status = beautyLabCatalogStatus({
			status: native,
			independentStatus: capability,
		});
		expect(status.makeupCards[0].ready).toBe(true);
		expect(native.makeupCards[0].ready).toBe(false);
		expect(status.available).toBe(false);
	});
});
