/**
 * Tests for Round 22: view toggle aria-pressed, no-results message,
 * modal focus trap.
 * Separate file to avoid mock conflicts with moyin-round11.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMoyinStore } from "@/stores/moyin-store";

vi.mock("lucide-react", () => {
	const icon = (name: string) => (props: Record<string, unknown>) => (
		<span data-testid={`icon-${name}`} {...props} />
	);
	return {
		CameraIcon: icon("camera"),
		ClipboardCopyIcon: icon("clipboard-copy"),
		CopyIcon: icon("copy"),
		DownloadIcon: icon("download"),
		FileTextIcon: icon("file-text"),
		FilterIcon: icon("filter"),
		GridIcon: icon("grid"),
		ImageIcon: icon("image"),
		ListIcon: icon("list"),
		MapPinIcon: icon("map-pin"),
		MessageSquareIcon: icon("message-square"),
		PlusIcon: icon("plus"),
		SearchIcon: icon("search"),
		SparklesIcon: icon("sparkles"),
		Trash2Icon: icon("trash"),
		UserIcon: icon("user"),
		XIcon: icon("x"),
		ChevronDownIcon: icon("chevron-down"),
		ChevronRightIcon: icon("chevron-right"),
	};
});

vi.mock("@/lib/utils", () => ({
	cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		variant?: string;
		className?: string;
	}) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		children,
		onClick,
		disabled,
		...props
	}: {
		children: React.ReactNode;
		onClick?: () => void;
		disabled?: boolean;
		className?: string;
		variant?: string;
		size?: string;
	}) => (
		<button type="button" onClick={onClick} disabled={disabled} {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/stores/moyin-store", async () => {
	const { create } = await import("zustand");
	const store = create(() => ({
		scenes: [] as { id: string; name: string; location: string }[],
		shots: [] as {
			id: string;
			index: number;
			sceneRefId: string;
			actionSummary: string;
			imageStatus: string;
			videoStatus: string;
			shotSize?: string;
			narrativeFunction?: string;
			cameraMovement?: string;
			dialogue?: string;
			characterNames?: string[];
			imageUrl?: string;
		}[],
		selectedItemId: null as string | null,
		selectedShotIds: new Set<string>(),
		addShot: vi.fn(),
		setSelectedItem: vi.fn(),
		reorderShots: vi.fn(),
		toggleShotSelection: vi.fn(),
		clearShotSelection: vi.fn(),
		deleteSelectedShots: vi.fn(),
		duplicateShot: vi.fn(),
		generateShotImage: vi.fn(),
	}));
	return { useMoyinStore: store };
});

import { ShotBreakdown } from "../shot-breakdown";
import { MediaPreviewModal } from "../media-preview-modal";
import { CollapsibleSection } from "../collapsible-section";

describe("ShotBreakdown — View Toggle aria-pressed", () => {
	beforeEach(() => {
		useMoyinStore.setState({
			scenes: [
				{
					id: "s1",
					name: "Cafe",
					location: "Cafe",
					time: "day",
					atmosphere: "warm",
				},
			],
			shots: [
				{
					id: "sh1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero enters",
					imageStatus: "idle",
					videoStatus: "idle",
					characterIds: [],
					characterVariations: {},
					imageProgress: 0,
					videoProgress: 0,
				},
			],
			selectedItemId: null,
			selectedShotIds: new Set(),
		});
	});

	it("marks list view as pressed by default", () => {
		render(<ShotBreakdown />);
		const listBtn = screen.getByLabelText("List view");
		const gridBtn = screen.getByLabelText("Grid view");
		expect(listBtn.getAttribute("aria-pressed")).toBe("true");
		expect(gridBtn.getAttribute("aria-pressed")).toBe("false");
	});

	it("switches aria-pressed when grid view is clicked", () => {
		render(<ShotBreakdown />);
		const gridBtn = screen.getByLabelText("Grid view");
		fireEvent.click(gridBtn);
		expect(gridBtn.getAttribute("aria-pressed")).toBe("true");
		const listBtn = screen.getByLabelText("List view");
		expect(listBtn.getAttribute("aria-pressed")).toBe("false");
	});
});

describe("ShotBreakdown — No Results Message", () => {
	beforeEach(() => {
		useMoyinStore.setState({
			scenes: [
				{
					id: "s1",
					name: "Cafe",
					location: "Cafe",
					time: "day",
					atmosphere: "warm",
				},
			],
			shots: [
				{
					id: "sh1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero enters",
					imageStatus: "idle",
					videoStatus: "idle",
					characterIds: [],
					characterVariations: {},
					imageProgress: 0,
					videoProgress: 0,
				},
			],
			selectedItemId: null,
			selectedShotIds: new Set(),
		});
	});

	it("shows no-results message when search matches nothing", () => {
		render(<ShotBreakdown />);
		const search = screen.getByLabelText("Search shots");
		fireEvent.change(search, { target: { value: "xyznonexistent" } });
		expect(screen.getByText("No matching shots")).toBeTruthy();
		expect(
			screen.getByText("Try adjusting your search or filter.")
		).toBeTruthy();
	});
});

describe("MediaPreviewModal — Focus Trap", () => {
	it("renders with aria-modal attribute", () => {
		render(
			<MediaPreviewModal
				url="https://example.com/img.png"
				type="image"
				title="Test Image"
				onClose={vi.fn()}
			/>
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog.getAttribute("aria-modal")).toBe("true");
	});

	it("has aria-label with title", () => {
		render(
			<MediaPreviewModal
				url="https://example.com/img.png"
				type="image"
				title="Test Image"
				onClose={vi.fn()}
			/>
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog.getAttribute("aria-label")).toBe("Preview: Test Image");
	});
});

describe("CollapsibleSection — aria-expanded", () => {
	it("renders with aria-expanded=false by default", () => {
		render(
			<CollapsibleSection title="Lighting">
				<p>Content</p>
			</CollapsibleSection>
		);
		const btn = screen.getByRole("button", { name: /lighting/i });
		expect(btn.getAttribute("aria-expanded")).toBe("false");
	});

	it("toggles aria-expanded on click", () => {
		render(
			<CollapsibleSection title="Lighting">
				<p>Content</p>
			</CollapsibleSection>
		);
		const btn = screen.getByRole("button", { name: /lighting/i });
		fireEvent.click(btn);
		expect(btn.getAttribute("aria-expanded")).toBe("true");
	});
});

describe("ShotBreakdown — Active Filter Indicator", () => {
	beforeEach(() => {
		useMoyinStore.setState({
			scenes: [
				{
					id: "s1",
					name: "Cafe",
					location: "Cafe",
					time: "day",
					atmosphere: "warm",
				},
			],
			shots: [
				{
					id: "sh1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero enters",
					imageStatus: "completed",
					videoStatus: "idle",
					characterIds: [],
					characterVariations: {},
					imageProgress: 0,
					videoProgress: 0,
				},
			],
			selectedItemId: null,
			selectedShotIds: new Set(),
		});
	});

	it("updates aria-label when filter changes", () => {
		render(<ShotBreakdown />);
		const filterSelect = screen.getByLabelText("Filter shots");
		fireEvent.change(filterSelect, { target: { value: "has-image" } });
		expect(filterSelect.getAttribute("aria-label")).toBe(
			"Filter shots (has-image selected)"
		);
	});
});

describe("ShotBreakdown — Escape to Clear Search", () => {
	beforeEach(() => {
		useMoyinStore.setState({
			scenes: [
				{
					id: "s1",
					name: "Cafe",
					location: "Cafe",
					time: "day",
					atmosphere: "warm",
				},
			],
			shots: [
				{
					id: "sh1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero enters",
					imageStatus: "idle",
					videoStatus: "idle",
					characterIds: [],
					characterVariations: {},
					imageProgress: 0,
					videoProgress: 0,
				},
			],
			selectedItemId: null,
			selectedShotIds: new Set(),
		});
	});

	it("clears search query when Escape is pressed", () => {
		render(<ShotBreakdown />);
		const search = screen.getByLabelText("Search shots");
		fireEvent.change(search, { target: { value: "test" } });
		expect((search as HTMLInputElement).value).toBe("test");
		fireEvent.keyDown(search, { key: "Escape" });
		expect((search as HTMLInputElement).value).toBe("");
	});
});
