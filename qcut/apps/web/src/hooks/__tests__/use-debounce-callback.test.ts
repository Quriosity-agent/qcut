import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDebounce } from "@/hooks/use-debounce";

describe("useDebounce - Advanced Tests", () => {
  it("handles null and undefined values", async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: null | undefined }) => useDebounce(value, 30),
      { initialProps: { value: null } }
    );

    expect(result.current).toBe(null);

    act(() => {
      rerender({ value: undefined as any });
    });
    expect(result.current).toBe(null);

    await waitFor(() => {
      expect(result.current).toBe(undefined);
    }, { timeout: 60 });
  });

  it("handles zero delay (immediate update)", async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 0),
      { initialProps: { value: "initial" } }
    );

    expect(result.current).toBe("initial");

    act(() => {
      rerender({ value: "updated" });
    });

    // Even with zero delay, setTimeout is still async and requires waiting
    await waitFor(() => {
      expect(result.current).toBe("updated");
    }, { timeout: 100 });
  });

  it("handles arrays and objects correctly", async () => {
    const initialArray = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 30),
      { initialProps: { value: initialArray } }
    );

    expect(result.current).toBe(initialArray);

    const newArray = [4, 5, 6];
    act(() => {
      rerender({ value: newArray });
    });

    await waitFor(() => {
      expect(result.current).toBe(newArray);
    }, { timeout: 100 });
    
    expect(result.current).toEqual([4, 5, 6]);
  });

  it("maintains referential equality for unchanged values", async () => {
    const obj = { test: "value" };
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 20),
      { initialProps: { value: obj } }
    );

    const firstRef = result.current;

    // Rerender with same object reference
    rerender({ value: obj });

    await new Promise(resolve => setTimeout(resolve, 30));

    expect(result.current).toBe(firstRef);
  });
});
