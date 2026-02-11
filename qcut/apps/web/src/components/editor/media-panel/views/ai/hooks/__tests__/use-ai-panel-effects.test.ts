import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAIPanelEffects } from "../use-ai-panel-effects";
import type { T2VModelCapabilities } from "../../constants/text2video-models-config";
import type {
  ReveAspectRatioOption,
  ReveOutputFormatOption,
} from "../../constants/ai-model-options";

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    combinedCapabilities: {
      supportsDuration: false,
      supportsAspectRatio: false,
      supportsResolution: false,
      supportsNegativePrompt: false,
      supportsPromptExpansion: false,
      supportsSeed: false,
      supportsSafetyChecker: false,
    } as T2VModelCapabilities,
    t2vAspectRatio: "16:9",
    t2vResolution: "720p",
    t2vDuration: 5,
    setT2vAspectRatio: vi.fn(),
    setT2vResolution: vi.fn(),
    setT2vDuration: vi.fn(),
    selectedModels: [] as string[],
    setReveAspectRatio: vi.fn() as (v: ReveAspectRatioOption) => void,
    setReveNumImages: vi.fn(),
    setReveOutputFormat: vi.fn() as (v: ReveOutputFormatOption) => void,
    firstFrame: null as File | null,
    lastFrame: null as File | null,
    firstFramePreview: null as string | null,
    setSelectedImage: vi.fn(),
    setImagePreview: vi.fn(),
    ...overrides,
  };
}

describe("useAIPanelEffects", () => {
  it("does not clamp when no supported values are defined", () => {
    const input = makeInput();
    renderHook(() => useAIPanelEffects(input));
    expect(input.setT2vAspectRatio).not.toHaveBeenCalled();
    expect(input.setT2vResolution).not.toHaveBeenCalled();
    expect(input.setT2vDuration).not.toHaveBeenCalled();
  });

  it("clamps aspect ratio when current value is not supported", () => {
    const input = makeInput({
      combinedCapabilities: {
        supportsDuration: false,
        supportsAspectRatio: true,
        supportedAspectRatios: ["9:16", "1:1"],
        supportsResolution: false,
        supportsNegativePrompt: false,
        supportsPromptExpansion: false,
        supportsSeed: false,
        supportsSafetyChecker: false,
      },
      t2vAspectRatio: "16:9",
    });
    renderHook(() => useAIPanelEffects(input));
    expect(input.setT2vAspectRatio).toHaveBeenCalledWith("9:16");
  });

  it("does not clamp when current value is in supported list", () => {
    const input = makeInput({
      combinedCapabilities: {
        supportsDuration: false,
        supportsAspectRatio: true,
        supportedAspectRatios: ["16:9", "9:16"],
        supportsResolution: false,
        supportsNegativePrompt: false,
        supportsPromptExpansion: false,
        supportsSeed: false,
        supportsSafetyChecker: false,
      },
      t2vAspectRatio: "16:9",
    });
    renderHook(() => useAIPanelEffects(input));
    expect(input.setT2vAspectRatio).not.toHaveBeenCalled();
  });

  it("resets Reve state when model is deselected", () => {
    const input = makeInput({ selectedModels: [] });
    renderHook(() => useAIPanelEffects(input));
    expect(input.setReveAspectRatio).toHaveBeenCalledWith("3:2");
    expect(input.setReveNumImages).toHaveBeenCalledWith(1);
    expect(input.setReveOutputFormat).toHaveBeenCalledWith("png");
  });

  it("does not reset Reve state when model is selected", () => {
    const input = makeInput({
      selectedModels: ["reve-text-to-image"],
    });
    renderHook(() => useAIPanelEffects(input));
    expect(input.setReveAspectRatio).not.toHaveBeenCalled();
    expect(input.setReveNumImages).not.toHaveBeenCalled();
    expect(input.setReveOutputFormat).not.toHaveBeenCalled();
  });

  it("syncs firstFrame to selectedImage when no lastFrame", () => {
    const file = new File([""], "test.png", { type: "image/png" });
    const input = makeInput({
      firstFrame: file,
      lastFrame: null,
      firstFramePreview: "blob:preview",
    });
    renderHook(() => useAIPanelEffects(input));
    expect(input.setSelectedImage).toHaveBeenCalledWith(file);
    expect(input.setImagePreview).toHaveBeenCalledWith("blob:preview");
  });

  it("clears selectedImage when both frames are set", () => {
    const file1 = new File([""], "first.png", { type: "image/png" });
    const file2 = new File([""], "last.png", { type: "image/png" });
    const input = makeInput({
      firstFrame: file1,
      lastFrame: file2,
      firstFramePreview: "blob:preview1",
    });
    renderHook(() => useAIPanelEffects(input));
    expect(input.setSelectedImage).toHaveBeenCalledWith(null);
    expect(input.setImagePreview).toHaveBeenCalledWith(null);
  });
});
