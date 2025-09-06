import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDebounce } from "@/hooks/use-debounce";

describe("useDebounce", () => {
  it("returns initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 50));
    expect(result.current).toBe("initial");
  });

  it("debounces value changes", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "initial", delay: 50 } }
    );

    expect(result.current).toBe("initial");

    // Change value
    rerender({ value: "updated", delay: 50 });

    // Value should not change immediately
    expect(result.current).toBe("initial");

    // Wait for debounce to complete
    await new Promise(resolve => setTimeout(resolve, 60));

    expect(result.current).toBe("updated");
  });

  it("works with complex objects", async () => {
    const initialObject = { count: 0, text: "hello" };
    const updatedObject = { count: 1, text: "world" };

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: initialObject, delay: 30 } }
    );

    expect(result.current).toEqual(initialObject);

    rerender({ value: updatedObject, delay: 30 });

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 40));

    expect(result.current).toEqual(updatedObject);
  });

  it("handles delay changes", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "initial", delay: 100 } }
    );

    rerender({ value: "updated", delay: 25 });

    // New delay should be respected
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current).toBe("updated");
  });
});
