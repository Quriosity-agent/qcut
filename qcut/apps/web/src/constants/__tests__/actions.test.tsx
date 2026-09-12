import { StrictMode, type MutableRefObject } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeAction, isActionBound, useActionHandler } from "../actions";

function Handler({
	onAction,
	active,
	action = "undo",
}: {
	onAction: () => void;
	active?: boolean | MutableRefObject<boolean>;
	action?: "undo" | "redo";
}) {
	useActionHandler(action, onAction, active);
	return null;
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("action handler lifecycle", () => {
	it("invokes once across StrictMode effect replay, updates, unmount and remount", () => {
		const first = vi.fn();
		const second = vi.fn();
		const view = render(
			<StrictMode>
				<Handler onAction={first} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(first).toHaveBeenCalledTimes(1);
		view.rerender(
			<StrictMode>
				<Handler onAction={second} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		view.unmount();
		act(() => invokeAction("undo"));
		expect(second).toHaveBeenCalledTimes(1);
		expect(isActionBound("undo")).toBe(false);
		const remount = render(
			<StrictMode>
				<Handler onAction={second} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(second).toHaveBeenCalledTimes(2);
		remount.unmount();
		expect(isActionBound("undo")).toBe(false);
	});

	it("keeps intentionally distinct subscribers and removes only the unmounted one", () => {
		const first = vi.fn();
		const second = vi.fn();
		const view = render(
			<StrictMode>
				<Handler key="first" onAction={first} />
				<Handler key="second" onAction={second} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		view.rerender(
			<StrictMode>
				<Handler key="second" onAction={second} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(2);
	});

	it("tracks boolean activation without duplicate registration", () => {
		const onAction = vi.fn();
		const view = render(
			<StrictMode>
				<Handler onAction={onAction} active={false} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(onAction).not.toHaveBeenCalled();
		view.rerender(
			<StrictMode>
				<Handler onAction={onAction} active />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(onAction).toHaveBeenCalledTimes(1);
		view.rerender(
			<StrictMode>
				<Handler onAction={onAction} active={false} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(isActionBound("undo")).toBe(false);
	});

	it("observes ref activation changes and releases polling and handlers on unmount", () => {
		vi.useFakeTimers();
		const active = { current: false };
		const onAction = vi.fn();
		const view = render(
			<StrictMode>
				<Handler onAction={onAction} active={active} />
			</StrictMode>
		);
		active.current = true;
		act(() => vi.advanceTimersByTime(100));
		act(() => invokeAction("undo"));
		expect(onAction).toHaveBeenCalledTimes(1);
		active.current = false;
		act(() => vi.advanceTimersByTime(100));
		act(() => invokeAction("undo"));
		expect(onAction).toHaveBeenCalledTimes(1);
		active.current = true;
		act(() => vi.advanceTimersByTime(100));
		view.unmount();
		expect(isActionBound("undo")).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("moves registration when the action changes", () => {
		const onAction = vi.fn();
		const view = render(
			<StrictMode>
				<Handler onAction={onAction} />
			</StrictMode>
		);
		view.rerender(
			<StrictMode>
				<Handler action="redo" onAction={onAction} />
			</StrictMode>
		);
		act(() => invokeAction("undo"));
		expect(onAction).not.toHaveBeenCalled();
		act(() => invokeAction("redo"));
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
