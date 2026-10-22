import { afterEach, describe, expect, it, vi } from "vitest";
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@/test/test-utils";
import { BeautyLabBodyPhoto } from "@/components/editor/properties-panel/beauty-lab/beauty-lab-body-photo";
import type {
	BodyPhotoLabAPI,
	BodyPhotoLabStatus,
} from "@/types/electron/api-body-photo-lab";
import { useBodyPhotoLab } from "../use-body-photo-lab";

const ready: BodyPhotoLabStatus = {
	available: true,
	provider: "qcut-body-photo-cpu-v3",
	message: "Ready",
	runtimeConfigured: true,
	windowOpen: false,
};
const missing: BodyPhotoLabStatus = {
	...ready,
	available: false,
	runtimeConfigured: false,
	message: "Choose resources",
};

function installAPI({
	overrides = {},
}: {
	overrides?: Partial<BodyPhotoLabAPI>;
} = {}) {
	const api = {
		inspect: vi.fn().mockResolvedValue(ready),
		open: vi.fn().mockResolvedValue({ opened: true }),
		close: vi.fn().mockResolvedValue({ closed: true }),
		chooseRuntime: vi.fn().mockResolvedValue(ready),
		...overrides,
	};
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { bodyPhotoLab: api },
	});
	return api;
}

afterEach(() => Reflect.deleteProperty(window, "electronAPI"));

describe("photo body launcher", () => {
	it("disables photo actions outside Desktop", () => {
		render(<BeautyLabBodyPhoto locale="zh" disabled={false} />);
		expect(screen.getByText("请在 QCut 桌面版中打开。")).toBeVisible();
		expect(screen.getByRole("button", { name: "打开照片美体" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "选择本地资源" })).toBeDisabled();
	});

	it("requires verified resources before opening and supports selection cancellation", async () => {
		const api = installAPI({
			overrides: {
				inspect: vi.fn().mockResolvedValue(missing),
				chooseRuntime: vi.fn().mockResolvedValue(missing),
			},
		});
		render(<BeautyLabBodyPhoto locale="en" disabled={false} />);
		await screen.findByText("Choose resources");
		expect(
			screen.getByRole("button", { name: "Open photo body" })
		).toBeDisabled();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose local resources" })
		);
		await waitFor(() => expect(api.chooseRuntime).toHaveBeenCalledTimes(1));
		expect(api.open).not.toHaveBeenCalled();
	});

	it("enables launch after the selected runtime finishes verification", async () => {
		let finishSelection = (_status: BodyPhotoLabStatus) => {};
		const api = installAPI({
			overrides: {
				inspect: vi
					.fn()
					.mockResolvedValueOnce(missing)
					.mockResolvedValue({ ...ready, windowOpen: true }),
				chooseRuntime: vi.fn(
					() =>
						new Promise<BodyPhotoLabStatus>((resolve) => {
							finishSelection = resolve;
						})
				),
			},
		});
		render(<BeautyLabBodyPhoto locale="en" disabled={false} />);
		await screen.findByText("Choose resources");
		const open = screen.getByRole("button", { name: "Open photo body" });
		const choose = screen.getByRole("button", {
			name: "Choose local resources",
		});
		fireEvent.click(choose);
		expect(choose).toBeDisabled();
		expect(open).toBeDisabled();
		await act(async () => finishSelection(ready));
		expect(open).toBeEnabled();
		expect(choose).toBeEnabled();
		expect(screen.queryByText("Choose resources")).not.toBeInTheDocument();
		fireEvent.click(open);
		await screen.findByRole("button", { name: "Close photo window" });
		expect(api.open).toHaveBeenCalledTimes(1);
	});

	it("allows choosing valid resources after a rejected folder", async () => {
		const chooseRuntime = vi
			.fn()
			.mockRejectedValueOnce(new Error("Missing pinned CPU models"))
			.mockResolvedValueOnce(ready);
		installAPI({
			overrides: {
				inspect: vi.fn().mockResolvedValue(missing),
				chooseRuntime,
			},
		});
		render(<BeautyLabBodyPhoto locale="en" disabled={false} />);
		await screen.findByText("Choose resources");
		const choose = screen.getByRole("button", {
			name: "Choose local resources",
		});
		fireEvent.click(choose);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Missing pinned CPU models"
		);
		expect(choose).toBeEnabled();
		expect(
			screen.getByRole("button", { name: "Open photo body" })
		).toBeDisabled();
		fireEvent.click(choose);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Open photo body" })
			).toBeEnabled()
		);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("keeps all actions disabled during an existing lab job", async () => {
		installAPI();
		render(<BeautyLabBodyPhoto locale="en" disabled={true} />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Choose local resources" })
			).toBeDisabled()
		);
		expect(
			screen.getByRole("button", { name: "Open photo body" })
		).toBeDisabled();
	});

	it("re-inspects after opening and closing the owned window", async () => {
		const inspect = vi
			.fn()
			.mockResolvedValueOnce(ready)
			.mockResolvedValueOnce({ ...ready, windowOpen: true })
			.mockResolvedValueOnce(ready);
		const api = installAPI({ overrides: { inspect } });
		const { result } = renderHook(() => useBodyPhotoLab());
		await waitFor(() => expect(result.current.status).toEqual(ready));
		await act(() => result.current.execute({ operation: "open" }));
		expect(result.current.status?.windowOpen).toBe(true);
		await act(() => result.current.execute({ operation: "close" }));
		expect(result.current.status?.windowOpen).toBe(false);
		expect(api.open).toHaveBeenCalledTimes(1);
		expect(api.close).toHaveBeenCalledTimes(1);
		expect(inspect).toHaveBeenCalledTimes(3);
	});

	it("does not race focus refresh or duplicate clicks against a pending open", async () => {
		let finish = () => {};
		const open = vi.fn(
			() =>
				new Promise<{ opened: true }>((resolve) => {
					finish = () => resolve({ opened: true });
				})
		);
		const inspect = vi.fn().mockResolvedValue(ready);
		installAPI({ overrides: { inspect, open } });
		const { result } = renderHook(() => useBodyPhotoLab());
		await waitFor(() => expect(result.current.status).toEqual(ready));
		let opening: Promise<void> = Promise.resolve();
		act(() => {
			opening = result.current.execute({ operation: "open" });
		});
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
			await result.current.execute({ operation: "open" });
		});
		expect(inspect).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledTimes(1);
		await act(async () => {
			finish();
			await opening;
		});
		expect(inspect).toHaveBeenCalledTimes(2);
		await act(async () => window.dispatchEvent(new Event("focus")));
		expect(inspect).toHaveBeenCalledTimes(3);
	});

	it("refreshes the launcher after the photo window closes and can reopen it", async () => {
		const api = installAPI({
			overrides: {
				inspect: vi
					.fn()
					.mockResolvedValueOnce({ ...ready, windowOpen: true })
					.mockResolvedValueOnce(ready)
					.mockResolvedValueOnce({ ...ready, windowOpen: true }),
			},
		});
		render(<BeautyLabBodyPhoto locale="en" disabled={false} />);
		await screen.findByRole("button", { name: "Close photo window" });
		await act(async () => window.dispatchEvent(new Event("focus")));
		expect(
			screen.queryByRole("button", { name: "Close photo window" })
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Open photo body" }));
		await screen.findByRole("button", { name: "Close photo window" });
		expect(api.open).toHaveBeenCalledTimes(1);
	});

	it("ignores an obsolete API response after the desktop session changes", async () => {
		let finish = (_status: BodyPhotoLabStatus) => {};
		installAPI({
			overrides: {
				inspect: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			},
		});
		const { result, rerender } = renderHook(() => useBodyPhotoLab());
		const current = { ...ready, windowOpen: true };
		installAPI({ overrides: { inspect: vi.fn().mockResolvedValue(current) } });
		rerender();
		await waitFor(() => expect(result.current.status).toEqual(current));
		await act(async () => finish(ready));
		expect(result.current.status).toEqual(current);
	});

	it("clears stale availability on launch failure and recovers on focus", async () => {
		const api = installAPI({
			overrides: { open: vi.fn().mockRejectedValue(new Error("Host exited")) },
		});
		const { result } = renderHook(() => useBodyPhotoLab());
		await waitFor(() => expect(result.current.status).toEqual(ready));
		await act(() => result.current.execute({ operation: "open" }));
		expect(result.current.error).toBe("Host exited");
		expect(result.current.status).toBeNull();
		await act(async () => window.dispatchEvent(new Event("focus")));
		expect(result.current.status).toEqual(ready);
		expect(result.current.error).toBeNull();
		expect(api.inspect).toHaveBeenCalledTimes(2);
	});
});
