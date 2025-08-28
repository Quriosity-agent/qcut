import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "@/hooks/use-debounce";

describe("useDebounce - Advanced Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles null and undefined values", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: null | undefined }) => useDebounce(value, 500),
      { initialProps: { value: null } }
    );

    expect(result.current).toBe(null);

    rerender({ value: undefined as any });
    expect(result.current).toBe(null);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(undefined);
  });

  it("handles zero delay (immediate update)", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 0),
      { initialProps: { value: "initial" } }
    );

    rerender({ value: "updated" });

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current).toBe("updated");
  });

  it("handles negative delay as zero", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, -100),
      { initialProps: { value: "initial" } }
    );

    rerender({ value: "changed" });

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current).toBe("changed");
  });

  it("handles very large delay values", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "start", delay: 999_999 } }
    );

    rerender({ value: "end", delay: 999_999 });

    // Value should not change even after a long time
    act(() => {
      vi.advanceTimersByTime(999_998);
    });

    expect(result.current).toBe("start");

    // But should change after the delay
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current).toBe("end");
  });

  it("handles arrays and objects correctly", () => {
    const initialArray = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: initialArray } }
    );

    expect(result.current).toBe(initialArray);

    const newArray = [4, 5, 6];
    rerender({ value: newArray });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(newArray);
    expect(result.current).toEqual([4, 5, 6]);
  });

  it("maintains referential equality for unchanged values", () => {
    const obj = { test: "value" };
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: obj } }
    );

    const firstRef = result.current;

    // Rerender with same object reference
    rerender({ value: obj });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe(firstRef);
  });
});
