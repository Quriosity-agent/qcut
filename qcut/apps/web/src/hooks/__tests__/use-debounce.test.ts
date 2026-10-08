import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "@/hooks/use-debounce";

// Fake timers keep these assertions independent of runner speed (real-time
// waits flaked on slow Windows CI runners).
beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("useDebounce", () => {
	it("returns initial value immediately", () => {
		const { result } = renderHook(() => useDebounce("initial", 50));
		expect(result.current).toBe("initial");
	});

	it("debounces value changes", () => {
		const { result, rerender } = renderHook(
			({ value, delay }) => useDebounce(value, delay),
			{ initialProps: { value: "initial", delay: 50 } }
		);

		rerender({ value: "updated", delay: 50 });
		expect(result.current).toBe("initial");

		act(() => {
			vi.advanceTimersByTime(49);
		});
		expect(result.current).toBe("initial");

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current).toBe("updated");
	});

	it("works with complex objects", () => {
		const initialObject = { count: 0, text: "hello" };
		const updatedObject = { count: 1, text: "world" };

		const { result, rerender } = renderHook(
			({ value, delay }) => useDebounce(value, delay),
			{ initialProps: { value: initialObject, delay: 30 } }
		);

		expect(result.current).toEqual(initialObject);

		rerender({ value: updatedObject, delay: 30 });
		act(() => {
			vi.advanceTimersByTime(30);
		});
		expect(result.current).toEqual(updatedObject);
	});

	it("handles delay changes", () => {
		const { result, rerender } = renderHook(
			({ value, delay }) => useDebounce(value, delay),
			{ initialProps: { value: "initial", delay: 100 } }
		);

		rerender({ value: "updated", delay: 25 });

		// The new, shorter delay applies to the pending update.
		act(() => {
			vi.advanceTimersByTime(24);
		});
		expect(result.current).toBe("initial");

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current).toBe("updated");
	});
});
