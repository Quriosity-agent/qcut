import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReveEditState } from "../use-reve-edit-state";
import { validateReveEditImage } from "@/lib/image-validation";
import { falAIClient } from "@/lib/fal-ai-client";

vi.mock("@/lib/image-validation", () => ({
  validateReveEditImage: vi.fn(),
}));

vi.mock("@/lib/fal-ai-client", () => ({
  falAIClient: {
    uploadImageToFal: vi.fn(),
  },
}));

describe("useReveEditState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null defaults", () => {
    const { result } = renderHook(() => useReveEditState());

    expect(result.current.uploadedImageForEdit).toBeNull();
    expect(result.current.uploadedImagePreview).toBeNull();
    expect(result.current.uploadedImageUrl).toBeNull();
  });

  it("clearUploadedImageForEdit resets all 3 fields", async () => {
    vi.mocked(validateReveEditImage).mockResolvedValue({
      valid: true,
      dimensions: { width: 512, height: 512 },
    });
    vi.mocked(falAIClient.uploadImageToFal).mockResolvedValue(
      "https://fal.example/image.png"
    );

    const { result } = renderHook(() => useReveEditState());
    const file = new File(["image"], "image.png", { type: "image/png" });

    await act(async () => {
      await result.current.handleImageUploadForEdit(file);
    });

    expect(result.current.uploadedImageForEdit).toBe(file);
    expect(result.current.uploadedImagePreview).toBeTruthy();
    expect(result.current.uploadedImageUrl).toBe(
      "https://fal.example/image.png"
    );

    act(() => {
      result.current.clearUploadedImageForEdit();
    });

    expect(result.current.uploadedImageForEdit).toBeNull();
    expect(result.current.uploadedImagePreview).toBeNull();
    expect(result.current.uploadedImageUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
