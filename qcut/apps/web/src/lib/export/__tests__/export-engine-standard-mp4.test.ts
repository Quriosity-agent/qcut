import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportSettingsWithAudio } from "@/types/export";
import {
	ExportEngineFactory,
	ExportEngineType,
} from "../export-engine-factory";
import { ExportEngineMuxer } from "../export-engine-muxer";
import { ExportEngine } from "../export-engine";

const engines = vi.hoisted(() => ({
	legacy: vi.fn(),
	muxer: vi.fn(),
	requiresFilterStack: false,
}));

vi.mock("../export-engine", () => ({
	ExportEngine: class {
		constructor(...args: unknown[]) {
			engines.legacy(...args);
		}
	},
}));
vi.mock("../export-engine-muxer", () => ({
	ExportEngineMuxer: class {
		constructor(...args: unknown[]) {
			engines.muxer(...args);
		}
	},
}));
vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ isElectron: true }),
}));
vi.mock("@/stores/stickers-overlay-store", () => ({
	useStickersOverlayStore: {
		getState: () => ({ getStickersForExport: () => [] }),
	},
}));
vi.mock("@/stores/ai/effects-store", () => ({
	useEffectsStore: { getState: () => ({ getElementEffects: () => [] }) },
}));
vi.mock("../export-filter-stack-policy", () => ({
	timelineHasEnabledFilterStack: () => engines.requiresFilterStack,
}));

const settings: ExportSettingsWithAudio = {
	format: "mp4",
	quality: "1080p",
	filename: "standard.mp4",
	width: 1080,
	height: 1920,
	frameRate: 30,
};

function createStandard({
	overrides = {},
}: {
	overrides?: Partial<ExportSettingsWithAudio>;
} = {}) {
	return ExportEngineFactory.getInstance().createEngine(
		document.createElement("canvas"),
		{ ...settings, ...overrides },
		[],
		[],
		3,
		ExportEngineType.STANDARD
	);
}

beforeEach(() => {
	engines.legacy.mockReset();
	engines.muxer.mockReset();
	engines.requiresFilterStack = false;
	for (const name of [
		"VideoEncoder",
		"VideoDecoder",
		"VideoFrame",
		"AudioEncoder",
		"AudioData",
	]) {
		vi.stubGlobal(name, class {});
	}
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Standard MP4 export", () => {
	it("uses the deterministic renderer with audio instead of wall-clock canvas capture", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const engine = await createStandard();
		expect(engine).toBeInstanceOf(ExportEngineMuxer);
		expect(engines.legacy).not.toHaveBeenCalled();
		expect(engines.muxer).toHaveBeenCalledWith(
			expect.any(HTMLCanvasElement),
			settings,
			[],
			[],
			3
		);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("Standard MP4 uses renderer-muxer")
		);
	});

	it.each([
		"VideoEncoder",
		"VideoDecoder",
		"VideoFrame",
		"AudioEncoder",
		"AudioData",
	])("refuses a silent or mistimed fallback without %s", async (name) => {
		vi.stubGlobal(name, undefined);
		await expect(createStandard()).rejects.toThrow("requires WebCodecs");
		expect(engines.legacy).not.toHaveBeenCalled();
		expect(engines.muxer).not.toHaveBeenCalled();
	});

	it("does not require audio codecs for an explicitly silent export", async () => {
		vi.stubGlobal("AudioEncoder", undefined);
		vi.stubGlobal("AudioData", undefined);
		expect(
			await createStandard({ overrides: { includeAudio: false } })
		).toBeInstanceOf(ExportEngineMuxer);
	});

	it("preserves the error when the deterministic encoder cannot initialize", async () => {
		const cause = new Error("encoder initialization failed");
		engines.muxer.mockImplementation(() => {
			throw cause;
		});
		await expect(createStandard()).rejects.toMatchObject({
			message: expect.stringContaining("export stopped"),
			cause,
		});
		expect(engines.legacy).not.toHaveBeenCalled();
	});

	it("keeps WebM on the separately supported legacy path", async () => {
		vi.stubGlobal("VideoEncoder", undefined);
		expect(
			await createStandard({ overrides: { format: "webm" } })
		).toBeInstanceOf(ExportEngine);
		expect(engines.muxer).not.toHaveBeenCalled();
	});

	it("keeps Standard MP4 fail-closed when Filter Lab already selected muxer", async () => {
		engines.requiresFilterStack = true;
		engines.muxer.mockImplementation(() => {
			throw new Error("muxer initialization failed");
		});
		await expect(createStandard()).rejects.toThrow("export stopped");
		expect(engines.legacy).not.toHaveBeenCalled();
	});

	it("checks audio support even when Filter Lab already selected muxer", async () => {
		engines.requiresFilterStack = true;
		vi.stubGlobal("AudioEncoder", undefined);
		await expect(createStandard()).rejects.toThrow("requires WebCodecs");
		expect(engines.legacy).not.toHaveBeenCalled();
		expect(engines.muxer).not.toHaveBeenCalled();
	});
});
