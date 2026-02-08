import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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
    act(() => {
      rerender({ value: "updated", delay: 50 });
    });

    // Value should not change immediately
    expect(result.current).toBe("initial");

    // Wait for debounce to complete - increase timeout
    await waitFor(
      () => {
        expect(result.current).toBe("updated");
      },
      { timeout: 200 }
    );
  });

  it("works with complex objects", async () => {
    const initialObject = { count: 0, text: "hello" };
    const updatedObject = { count: 1, text: "world" };

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: initialObject, delay: 30 } }
    );

    expect(result.current).toEqual(initialObject);

    act(() => {
      rerender({ value: updatedObject, delay: 30 });
    });

    // Wait for debounce
    await waitFor(
      () => {
        expect(result.current).toEqual(updatedObject);
      },
      { timeout: 200 }
    );
  });

  it("handles delay changes", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "initial", delay: 100 } }
    );

    act(() => {
      rerender({ value: "updated", delay: 25 });
    });

    // New delay should be respected - increase timeout for safety
    await waitFor(
      () => {
        expect(result.current).toBe("updated");
      },
      { timeout: 100 }
    );
  });
});
