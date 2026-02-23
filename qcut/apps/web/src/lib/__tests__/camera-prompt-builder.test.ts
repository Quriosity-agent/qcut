import { describe, it, expect } from "vitest";
import { buildCameraPrompt } from "../ai-models/camera-prompt-builder";
import {
	CAMERAS,
	LENSES,
	FOCAL_LENGTHS,
	APERTURE_OPTIONS,
} from "@/stores/editor/camera-selector-store";

const DEFAULT_OPTIONS = {
	cameraIndex: 0,
	lensIndex: 0,
	focalIndex: 3,
	apertureIndex: 0,
};

describe("buildCameraPrompt", () => {
	it("should produce a prompt containing camera, lens, focal, and aperture", () => {
		const prompt = buildCameraPrompt(DEFAULT_OPTIONS);
		expect(prompt).toContain("Red V-Raptor");
		expect(prompt).toContain("Helios");
		expect(prompt).toContain("50mm");
		expect(prompt).toContain("f/1.4");
	});

	it("should start with 'Cinematic shot on' when no subject", () => {
		const prompt = buildCameraPrompt(DEFAULT_OPTIONS);
		expect(prompt).toMatch(/^Cinematic shot on/);
	});

	it("should end with 'professional cinematography'", () => {
		const prompt = buildCameraPrompt(DEFAULT_OPTIONS);
		expect(prompt).toMatch(/professional cinematography$/);
	});

	describe("camera body type flavor", () => {
		it("should include digital flavor for DIGITAL cameras", () => {
			const digitalIdx = CAMERAS.findIndex((c) => c.type === "DIGITAL");
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				cameraIndex: digitalIdx,
			});
			expect(prompt).toContain("digital cinema look");
		});

		it("should include film flavor for FILM cameras", () => {
			const filmIdx = CAMERAS.findIndex((c) => c.type === "FILM");
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				cameraIndex: filmIdx,
			});
			expect(prompt).toContain("organic film grain");
		});
	});

	describe("lens type traits", () => {
		it("should include spherical traits for SPHERICAL lenses", () => {
			const idx = LENSES.findIndex((l) => l.type === "SPHERICAL");
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, lensIndex: idx });
			expect(prompt).toContain("natural bokeh");
		});

		it("should include anamorphic traits for ANAMORPHIC lenses", () => {
			const idx = LENSES.findIndex((l) => l.type === "ANAMORPHIC");
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, lensIndex: idx });
			expect(prompt).toContain("horizontal lens flare");
		});

		it("should include special traits for SPECIAL lenses", () => {
			const idx = LENSES.findIndex((l) => l.type === "SPECIAL");
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, lensIndex: idx });
			expect(prompt).toContain("creative optical distortion");
		});
	});

	describe("focal length descriptions", () => {
		it("should describe 8mm as ultra-wide", () => {
			const idx = FOCAL_LENGTHS.indexOf(8);
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, focalIndex: idx });
			expect(prompt).toContain("ultra-wide");
		});

		it("should describe 14mm as wide-angle", () => {
			const idx = FOCAL_LENGTHS.indexOf(14);
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, focalIndex: idx });
			expect(prompt).toContain("wide-angle");
		});

		it("should describe 35mm as standard cinematic", () => {
			const idx = FOCAL_LENGTHS.indexOf(35);
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, focalIndex: idx });
			expect(prompt).toContain("standard cinematic");
		});

		it("should describe 50mm as natural perspective", () => {
			const idx = FOCAL_LENGTHS.indexOf(50);
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, focalIndex: idx });
			expect(prompt).toContain("natural perspective");
		});
	});

	describe("aperture descriptions", () => {
		it("should describe f/1.4 as shallow depth of field", () => {
			const idx = APERTURE_OPTIONS.findIndex((a) => a.label === "f/1.4");
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				apertureIndex: idx,
			});
			expect(prompt).toContain("shallow depth of field");
		});

		it("should describe f/4 as moderate depth of field", () => {
			const idx = APERTURE_OPTIONS.findIndex((a) => a.label === "f/4");
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				apertureIndex: idx,
			});
			expect(prompt).toContain("moderate depth of field");
		});

		it("should describe f/11 as deep focus", () => {
			const idx = APERTURE_OPTIONS.findIndex((a) => a.label === "f/11");
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				apertureIndex: idx,
			});
			expect(prompt).toContain("deep focus");
		});
	});

	describe("subject handling", () => {
		it("should prepend subject when provided", () => {
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				subject: "a woman walking through rain",
			});
			expect(prompt).toMatch(
				/^a woman walking through rain, Cinematic shot on/
			);
		});

		it("should trim whitespace from subject", () => {
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				subject: "  padded subject  ",
			});
			expect(prompt).toMatch(/^padded subject, Cinematic shot on/);
		});

		it("should omit subject when undefined", () => {
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				subject: undefined,
			});
			expect(prompt).toMatch(/^Cinematic shot on/);
		});

		it("should omit subject when empty string", () => {
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, subject: "" });
			expect(prompt).toMatch(/^Cinematic shot on/);
		});

		it("should omit subject when whitespace only", () => {
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, subject: "   " });
			expect(prompt).toMatch(/^Cinematic shot on/);
		});
	});

	describe("boundary indices", () => {
		it("should handle first camera (index 0)", () => {
			const prompt = buildCameraPrompt({ ...DEFAULT_OPTIONS, cameraIndex: 0 });
			expect(prompt).toContain(CAMERAS[0].name);
		});

		it("should handle last camera", () => {
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				cameraIndex: CAMERAS.length - 1,
			});
			expect(prompt).toContain(CAMERAS[CAMERAS.length - 1].name);
		});

		it("should handle last lens", () => {
			const prompt = buildCameraPrompt({
				...DEFAULT_OPTIONS,
				lensIndex: LENSES.length - 1,
			});
			expect(prompt).toContain(LENSES[LENSES.length - 1].name);
		});

		it("should fall back to defaults for out-of-range indices", () => {
			const prompt = buildCameraPrompt({
				cameraIndex: 999,
				lensIndex: 999,
				focalIndex: 999,
				apertureIndex: 999,
			});
			// Falls back to first camera/lens and default focal/aperture
			expect(prompt).toContain(CAMERAS[0].name);
			expect(prompt).toContain(LENSES[0].name);
		});
	});
});
