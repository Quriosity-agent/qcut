/**
 * Moyin generation configuration store.
 * Project-level settings for image/video generation (aspect ratio, resolution, etc.).
 * Separated from moyin-store.ts to respect the 800-line limit.
 */

import { create } from "zustand";

export type AspectRatio = "landscape" | "portrait";
export type Resolution = "480p" | "720p" | "1080p" | "2k";
export type GenMode = "single" | "merged";

interface MoyinGenConfig {
	aspectRatio: AspectRatio;
	resolution: Resolution;
	genMode: GenMode;
	qualityPrompt: string;
}

interface MoyinGenConfigActions {
	setAspectRatio: (v: AspectRatio) => void;
	setResolution: (v: Resolution) => void;
	setGenMode: (v: GenMode) => void;
	setQualityPrompt: (v: string) => void;
	reset: () => void;
}

const DEFAULTS: MoyinGenConfig = {
	aspectRatio: "landscape",
	resolution: "1080p",
	genMode: "single",
	qualityPrompt: "best quality, masterpiece, highly detailed",
};

const STORAGE_KEY = "moyin-gen-config";

function loadFromStorage(): Partial<MoyinGenConfig> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as Partial<MoyinGenConfig>;
	} catch {
		return {};
	}
}

function saveToStorage(state: MoyinGenConfig): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// silently skip
	}
}

export const useMoyinGenConfig = create<MoyinGenConfig & MoyinGenConfigActions>(
	(set, get) => ({
		...DEFAULTS,
		...loadFromStorage(),

		setAspectRatio: (v) => {
			set({ aspectRatio: v });
			saveToStorage({ ...get(), aspectRatio: v });
		},
		setResolution: (v) => {
			set({ resolution: v });
			saveToStorage({ ...get(), resolution: v });
		},
		setGenMode: (v) => {
			set({ genMode: v });
			saveToStorage({ ...get(), genMode: v });
		},
		setQualityPrompt: (v) => {
			set({ qualityPrompt: v });
			saveToStorage({ ...get(), qualityPrompt: v });
		},
		reset: () => {
			set(DEFAULTS);
			saveToStorage(DEFAULTS);
		},
	})
);
