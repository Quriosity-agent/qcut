import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDebounce } from "@/hooks/use-debounce";

describe("useDebounce - Advanced Tests", () => {
  it("handles null and undefined values", async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: null | undefined }) => useDebounce(value, 30),
      { initialProps: { value: null } }
    );

    expect(result.current).toBe(null);

    rerender({ value: undefined as any });
    expect(result.current).toBe(null);

    await new Promise(resolve => setTimeout(resolve, 40));

    expect(result.current).toBe(undefined);
  });

  it("handles zero delay (immediate update)", async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 0),
      { initialProps: { value: "initial" } }
    );

    rerender({ value: "updated" });

    // Even with 0 delay, there's still a microtask
    await new Promise(resolve => setTimeout(resolve, 1));

    expect(result.current).toBe("updated");
  });

  it("handles arrays and objects correctly", async () => {
    const initialArray = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 30),
      { initialProps: { value: initialArray } }
    );

    expect(result.current).toBe(initialArray);

    const newArray = [4, 5, 6];
    rerender({ value: newArray });

    await new Promise(resolve => setTimeout(resolve, 40));

    expect(result.current).toBe(newArray);
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
