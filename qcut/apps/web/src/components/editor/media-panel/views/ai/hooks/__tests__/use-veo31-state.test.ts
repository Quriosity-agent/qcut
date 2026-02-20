import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVeo31State } from "../use-veo31-state";

describe("useVeo31State", () => {
	it("returns default settings", () => {
		const { result } = renderHook(() => useVeo31State());

		expect(result.current.veo31Settings).toEqual({
			resolution: "720p",
			duration: "8s",
			aspectRatio: "16:9",
			generateAudio: true,
			enhancePrompt: true,
			autoFix: true,
		});
		expect(result.current.firstFrame).toBeNull();
		expect(result.current.lastFrame).toBeNull();
	});

	it("setVeo31Resolution updates correctly", () => {
		const { result } = renderHook(() => useVeo31State());

		act(() => {
			result.current.setVeo31Resolution("1080p");
		});

		expect(result.current.veo31Settings.resolution).toBe("1080p");
	});

	it("setFirstFrame and setLastFrame update correctly", () => {
		const { result } = renderHook(() => useVeo31State());
		const firstFrame = new File(["first"], "first.png", { type: "image/png" });
		const lastFrame = new File(["last"], "last.png", { type: "image/png" });

		act(() => {
			result.current.setFirstFrame(firstFrame);
			result.current.setLastFrame(lastFrame);
		});

		expect(result.current.firstFrame).toBe(firstFrame);
		expect(result.current.lastFrame).toBe(lastFrame);
	});
});
