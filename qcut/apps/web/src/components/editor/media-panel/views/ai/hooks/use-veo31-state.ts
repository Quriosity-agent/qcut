import { useCallback, useState } from "react";

export interface Veo31Settings {
	resolution: "720p" | "1080p";
	duration: "4s" | "6s" | "8s";
	aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
	generateAudio: boolean;
	enhancePrompt: boolean;
	autoFix: boolean;
}

const DEFAULT_VEO31_SETTINGS: Veo31Settings = {
	resolution: "720p",
	duration: "8s",
	aspectRatio: "16:9",
	generateAudio: true,
	enhancePrompt: true,
	autoFix: true,
};

function getDefaultVeo31Settings(): Veo31Settings {
	return { ...DEFAULT_VEO31_SETTINGS };
}

export function useVeo31State() {
	const [veo31Settings, setVeo31Settings] = useState<Veo31Settings>(
		getDefaultVeo31Settings
	);
	const [firstFrame, setFirstFrame] = useState<File | null>(null);
	const [lastFrame, setLastFrame] = useState<File | null>(null);

	const setVeo31Resolution = useCallback((resolution: "720p" | "1080p") => {
		setVeo31Settings((prev) => ({ ...prev, resolution }));
	}, []);

	const setVeo31Duration = useCallback((duration: "4s" | "6s" | "8s") => {
		setVeo31Settings((prev) => ({ ...prev, duration }));
	}, []);

	const setVeo31AspectRatio = useCallback(
		(aspectRatio: "9:16" | "16:9" | "1:1" | "auto") => {
			setVeo31Settings((prev) => ({ ...prev, aspectRatio }));
		},
		[]
	);

	const setVeo31GenerateAudio = useCallback((generateAudio: boolean) => {
		setVeo31Settings((prev) => ({ ...prev, generateAudio }));
	}, []);

	const setVeo31EnhancePrompt = useCallback((enhancePrompt: boolean) => {
		setVeo31Settings((prev) => ({ ...prev, enhancePrompt }));
	}, []);

	const setVeo31AutoFix = useCallback((autoFix: boolean) => {
		setVeo31Settings((prev) => ({ ...prev, autoFix }));
	}, []);

	const resetVeo31State = useCallback(() => {
		setVeo31Settings(getDefaultVeo31Settings());
		setFirstFrame(null);
		setLastFrame(null);
	}, []);

	return {
		veo31Settings,
		setVeo31Settings,
		setVeo31Resolution,
		setVeo31Duration,
		setVeo31AspectRatio,
		setVeo31GenerateAudio,
		setVeo31EnhancePrompt,
		setVeo31AutoFix,
		firstFrame,
		setFirstFrame,
		lastFrame,
		setLastFrame,
		resetVeo31State,
	};
}
