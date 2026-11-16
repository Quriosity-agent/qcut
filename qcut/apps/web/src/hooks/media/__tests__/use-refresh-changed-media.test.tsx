import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({})));
const settle = vi.hoisted(() =>
	vi.fn(
		async (
			..._args: unknown[]
		): Promise<{ lookAgainAt?: number; dropped: number }> => ({ dropped: 0 })
	)
);
const stores = vi.hoisted(() => ({
	projectId: "p1" as string | undefined,
	/** The project the stores have finished loading. */
	loadedProjectId: "p1" as string | null,
	mediaLoaded: true,
}));

vi.mock("@/lib/project/media-source-refresh", () => ({
	refreshChangedMediaSources: refresh,
}));
vi.mock("@/stores/media/media-rename", () => ({
	settleUnsettledMediaRenames: settle,
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: (
		select: (state: {
			activeProject?: { id: string };
			loadedProjectId: string | null;
		}) => unknown
	) =>
		select({
			activeProject: stores.projectId ? { id: stores.projectId } : undefined,
			loadedProjectId: stores.loadedProjectId,
		}),
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: (
		select: (state: { hasInitialized: boolean; isLoading: boolean }) => unknown
	) => select({ hasInitialized: stores.mediaLoaded, isLoading: false }),
}));

import { useRefreshChangedMedia } from "../use-refresh-changed-media";

const lookAtWindow = () => window.dispatchEvent(new Event("focus"));

describe("checking the project's media files when the window is looked at", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		stores.projectId = "p1";
		stores.loadedProjectId = "p1";
		stores.mediaLoaded = true;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("checks once the project's media has loaded, and again when the window is looked at", () => {
		renderHook(() => useRefreshChangedMedia());
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith({ projectId: "p1" });

		vi.advanceTimersByTime(5000);
		lookAtWindow();
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	/**
	 * A rename can end with the editor and the folder apart, and is then
	 * noted. It is settled when the project is all there, not before: the
	 * timeline is loaded after the media.
	 */
	it("settles the renames noted for the project once it has finished loading", () => {
		stores.loadedProjectId = null;
		const { rerender } = renderHook(() => useRefreshChangedMedia());
		expect(settle).not.toHaveBeenCalled();

		stores.loadedProjectId = "p1";
		rerender();
		expect(settle).toHaveBeenCalledTimes(1);
		expect(settle).toHaveBeenCalledWith({ projectId: "p1" });
		// Not on every look at the window.
		vi.advanceTimersByTime(5000);
		lookAtWindow();
		expect(settle).toHaveBeenCalledTimes(1);
	});

	/**
	 * A rename the desktop app noted and may still be at work on is left
	 * alone when the project loads. Nothing else settles renames while the
	 * project stays open, so it is looked at again once the app must be done.
	 */
	it("looks again at a rename the desktop app was still at work on", async () => {
		settle.mockResolvedValueOnce({
			lookAgainAt: Date.now() + 120_000,
			dropped: 0,
		});
		renderHook(() => useRefreshChangedMedia());
		expect(settle).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(119_000);
		expect(settle).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(settle).toHaveBeenCalledTimes(2);
		// Settled by then: not looked at any more.
		await vi.advanceTimersByTimeAsync(600_000);
		expect(settle).toHaveBeenCalledTimes(2);
	});

	it("does not look again once the project is closed", async () => {
		settle.mockResolvedValueOnce({
			lookAgainAt: Date.now() + 120_000,
			dropped: 0,
		});
		const { unmount } = renderHook(() => useRefreshChangedMedia());
		await vi.advanceTimersByTimeAsync(1000);
		unmount();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(settle).toHaveBeenCalledTimes(1);
	});

	/**
	 * The check leaves an item of a rename that is not settled as it is.
	 * Once the rename is settled, the item is looked at.
	 */
	it("checks the media files again once a noted rename was settled", async () => {
		settle.mockResolvedValueOnce({ dropped: 1 });
		renderHook(() => useRefreshChangedMedia());
		expect(refresh).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(0);
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenLastCalledWith({ projectId: "p1" });
	});

	it("does not check again when no rename was settled", async () => {
		renderHook(() => useRefreshChangedMedia());
		await vi.advanceTimersByTimeAsync(0);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("waits for a project and its media", () => {
		stores.mediaLoaded = false;
		renderHook(() => useRefreshChangedMedia());
		lookAtWindow();
		expect(refresh).not.toHaveBeenCalled();
	});

	/**
	 * A file rendered again a second after the last check, and the window
	 * looked at straight away, used to be passed over for good: nothing
	 * checks again while the window stays in front.
	 */
	it("makes up for a look that came too soon after the last check", () => {
		renderHook(() => useRefreshChangedMedia());
		expect(refresh).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1000);
		lookAtWindow();
		lookAtWindow();
		expect(refresh).toHaveBeenCalledTimes(1);

		// Once the three seconds since the last check are over, and once only.
		vi.advanceTimersByTime(1999);
		expect(refresh).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(refresh).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(10_000);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("drops the check it owed when the project is closed", () => {
		const { unmount } = renderHook(() => useRefreshChangedMedia());
		vi.advanceTimersByTime(1000);
		lookAtWindow();
		unmount();
		vi.advanceTimersByTime(10_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
