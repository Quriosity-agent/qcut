import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaToolbar } from "../media-toolbar";

function renderToolbar(
	overrides: Partial<Parameters<typeof MediaToolbar>[0]> = {}
) {
	const props = {
		isProcessing: false,
		isSyncing: false,
		onImport: vi.fn(),
		onSync: vi.fn(),
		searchQuery: "",
		onSearchChange: vi.fn(),
		viewMode: "grid" as const,
		onViewModeChange: vi.fn(),
		sortBy: "name" as const,
		sortDirection: "asc" as const,
		onSortByChange: vi.fn(),
		onSortDirectionChange: vi.fn(),
		mediaFilter: "all" as const,
		onMediaFilterChange: vi.fn(),
		...overrides,
	};
	render(<MediaToolbar {...props} />);
	return props;
}

describe("MediaToolbar", () => {
	it("toggles between grid and list from one button", () => {
		const props = renderToolbar();
		fireEvent.click(screen.getByTestId("media-view-toggle"));
		expect(props.onViewModeChange).toHaveBeenCalledWith("list");
	});

	it("offers the other mode once the list is showing", () => {
		const props = renderToolbar({ viewMode: "list" });
		expect(screen.getByTestId("media-view-toggle")).toHaveAttribute(
			"data-view-mode",
			"list"
		);
		fireEvent.click(screen.getByTestId("media-view-toggle"));
		expect(props.onViewModeChange).toHaveBeenCalledWith("grid");
	});

	it("routes import, sync and search to their callbacks", () => {
		const props = renderToolbar();
		fireEvent.click(screen.getByTestId("import-media-button"));
		fireEvent.click(screen.getByTestId("media-sync-button"));
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "shot" },
		});
		expect(props.onImport).toHaveBeenCalledTimes(1);
		expect(props.onSync).toHaveBeenCalledTimes(1);
		expect(props.onSearchChange).toHaveBeenCalledWith("shot");
	});

	it("disables sync while a sync or import is running", () => {
		renderToolbar({ isSyncing: true });
		expect(screen.getByTestId("media-sync-button")).toBeDisabled();
	});

	it("lists every sort key plus both directions with the active ones checked", async () => {
		const props = renderToolbar({ sortBy: "duration", sortDirection: "desc" });
		fireEvent.pointerDown(screen.getByTestId("media-sort-trigger"), {
			button: 0,
			ctrlKey: false,
			pointerType: "mouse",
		});
		const items = await screen.findAllByRole("menuitemcheckbox");
		expect(items).toHaveLength(7);
		const checked = items
			.filter((item) => item.getAttribute("aria-checked") === "true")
			.map((item) => item.textContent);
		expect(checked).toHaveLength(2);
		expect(checked[1]).toBe("Z–A");
		fireEvent.click(items[0]);
		expect(props.onSortByChange).toHaveBeenCalledWith("importTime");
	});

	it("marks the filter trigger when a type filter is active", () => {
		renderToolbar({ mediaFilter: "video" });
		expect(screen.getByTestId("media-filter-trigger").className).toContain(
			"text-primary"
		);
	});
});
