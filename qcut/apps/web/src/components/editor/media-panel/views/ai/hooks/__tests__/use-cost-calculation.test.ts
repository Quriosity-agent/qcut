import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCostCalculation } from "../use-cost-calculation";

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    selectedModels: [] as string[],
    reveNumImages: 1,
    generationDuration: 4,
    generationResolution: "720p",
    veo31Duration: "6",
    veo31GenerateAudio: false,
    hailuoT2VDuration: 5,
    ltxv2FastDuration: 5,
    ltxv2FastResolution: "480p",
    ltxv2ImageDuration: 5,
    ltxv2ImageResolution: "480p",
    bytedanceTargetResolution: "2160p",
    bytedanceTargetFPS: "24",
    flashvsrUpscaleFactor: 2,
    videoMetadata: null,
    ...overrides,
  };
}

describe("useCostCalculation", () => {
  it("returns zero cost with no models selected", () => {
    const { result } = renderHook(() => useCostCalculation(makeInput()));
    expect(result.current.totalCost).toBe(0);
    expect(result.current.hasRemixSelected).toBe(false);
  });

  it("detects remix selection", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["sora2_video_to_video_remix"],
        })
      )
    );
    expect(result.current.hasRemixSelected).toBe(true);
    expect(result.current.totalCost).toBe(0);
  });

  it("calculates Sora 2 pro cost based on duration and resolution", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["sora2_text_to_video_pro"],
          generationDuration: 8,
          generationResolution: "1080p",
        })
      )
    );
    // 1080p: duration * 0.5 = 8 * 0.5 = 4.0
    expect(result.current.totalCost).toBe(4.0);
  });

  it("calculates Sora 2 pro cost at 720p", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["sora2_text_to_video_pro"],
          generationDuration: 8,
          generationResolution: "720p",
        })
      )
    );
    // 720p: duration * 0.3 = 8 * 0.3 = 2.4
    expect(result.current.totalCost).toBeCloseTo(2.4);
  });

  it("calculates Veo 3.1 cost with audio", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["veo31_standard_t2v"],
          veo31Duration: "8",
          veo31GenerateAudio: true,
        })
      )
    );
    // Standard with audio: 8 * 0.4 = 3.2
    expect(result.current.totalCost).toBeCloseTo(3.2);
  });

  it("calculates Veo 3.1 fast cost without audio", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["veo31_fast_t2v"],
          veo31Duration: "6",
          veo31GenerateAudio: false,
        })
      )
    );
    // Fast without audio: 6 * 0.1 = 0.6
    expect(result.current.totalCost).toBeCloseTo(0.6);
  });

  it("calculates Hailuo T2V cost for 10s duration", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["hailuo23_standard_t2v"],
          hailuoT2VDuration: 10,
        })
      )
    );
    expect(result.current.totalCost).toBe(0.56);
  });

  it("calculates Hailuo T2V cost for 5s duration", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: ["hailuo23_standard_t2v"],
          hailuoT2VDuration: 5,
        })
      )
    );
    expect(result.current.totalCost).toBe(0.28);
  });

  it("sums costs for multiple models", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          selectedModels: [
            "sora2_video_to_video_remix",
            "hailuo23_standard_t2v",
          ],
          hailuoT2VDuration: 10,
        })
      )
    );
    // remix = 0, hailuo 10s = 0.56
    expect(result.current.totalCost).toBeCloseTo(0.56);
  });

  it("returns bytedance estimated cost as a string", () => {
    const { result } = renderHook(() => useCostCalculation(makeInput()));
    expect(typeof result.current.bytedanceEstimatedCost).toBe("string");
    expect(result.current.bytedanceEstimatedCost).toMatch(/^\$/);
  });

  it("returns flashvsr estimated cost as $0.000 when no metadata", () => {
    const { result } = renderHook(() =>
      useCostCalculation(makeInput({ videoMetadata: null }))
    );
    expect(result.current.flashvsrEstimatedCost).toBe("$0.000");
  });

  it("returns flashvsr cost when metadata is present", () => {
    const { result } = renderHook(() =>
      useCostCalculation(
        makeInput({
          videoMetadata: {
            width: 1920,
            height: 1080,
            duration: 10,
            fps: 30,
          },
          flashvsrUpscaleFactor: 2,
        })
      )
    );
    expect(result.current.flashvsrEstimatedCost).toMatch(/^\$/);
    expect(result.current.flashvsrEstimatedCost).not.toBe("$0.000");
  });
});
