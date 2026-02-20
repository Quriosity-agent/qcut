import { describe, it, expect, beforeEach } from "vitest";
import {
	useCameraSelectorStore,
	CAMERAS,
	LENSES,
	FOCAL_LENGTHS,
	APERTURE_OPTIONS,
} from "../camera-selector-store";

describe("camera-selector-store", () => {
	beforeEach(() => {
		// Reset store to defaults
		useCameraSelectorStore.setState({
			cameraIndex: 0,
			lensIndex: 0,
			focalIndex: 3,
			apertureIndex: 0,
		});
	});

	describe("initial state", () => {
		it("should have default camera index 0", () => {
			expect(useCameraSelectorStore.getState().cameraIndex).toBe(0);
		});

		it("should have default lens index 0", () => {
			expect(useCameraSelectorStore.getState().lensIndex).toBe(0);
		});

		it("should have default focal index 3 (50mm)", () => {
			expect(useCameraSelectorStore.getState().focalIndex).toBe(3);
		});

		it("should have default aperture index 0", () => {
			expect(useCameraSelectorStore.getState().apertureIndex).toBe(0);
		});
	});

	describe("setters", () => {
		it("should update camera index", () => {
			useCameraSelectorStore.getState().setCameraIndex(2);
			expect(useCameraSelectorStore.getState().cameraIndex).toBe(2);
		});

		it("should update lens index", () => {
			useCameraSelectorStore.getState().setLensIndex(5);
			expect(useCameraSelectorStore.getState().lensIndex).toBe(5);
		});

		it("should update focal index", () => {
			useCameraSelectorStore.getState().setFocalIndex(1);
			expect(useCameraSelectorStore.getState().focalIndex).toBe(1);
		});

		it("should update aperture index", () => {
			useCameraSelectorStore.getState().setApertureIndex(2);
			expect(useCameraSelectorStore.getState().apertureIndex).toBe(2);
		});
	});

	describe("static data", () => {
		it("should have 6 cameras", () => {
			expect(CAMERAS).toHaveLength(6);
		});

		it("should have 11 lenses", () => {
			expect(LENSES).toHaveLength(11);
		});

		it("should have 4 focal lengths", () => {
			expect(FOCAL_LENGTHS).toHaveLength(4);
		});

		it("should have 3 aperture options", () => {
			expect(APERTURE_OPTIONS).toHaveLength(3);
		});

		it("cameras should have name, type, and img", () => {
			for (const cam of CAMERAS) {
				expect(cam).toHaveProperty("name");
				expect(cam).toHaveProperty("type");
				expect(cam).toHaveProperty("img");
				expect(["DIGITAL", "FILM"]).toContain(cam.type);
			}
		});

		it("lenses should have name, type, and img", () => {
			for (const lens of LENSES) {
				expect(lens).toHaveProperty("name");
				expect(lens).toHaveProperty("type");
				expect(lens).toHaveProperty("img");
				expect(["SPHERICAL", "ANAMORPHIC", "SPECIAL"]).toContain(lens.type);
			}
		});

		it("aperture options should have label and img", () => {
			for (const apt of APERTURE_OPTIONS) {
				expect(apt).toHaveProperty("label");
				expect(apt).toHaveProperty("img");
			}
		});
	});
});
