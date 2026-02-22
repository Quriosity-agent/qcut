import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMoyinStore } from "@/stores/moyin-store";

// Mock TanStack Router — return empty project_id to prevent loadProject from resetting state
vi.mock("@tanstack/react-router", () => ({
	useParams: () => ({ project_id: "" }),
}));

// Mock lucide-react icons as simple spans
vi.mock("lucide-react", () => {
	const icon = (name: string) => (props: Record<string, unknown>) => (
		<span data-testid={`icon-${name}`} {...props} />
	);
	return {
		AlertTriangleIcon: icon("alert-triangle"),
		ArrowLeftIcon: icon("arrow-left"),
		ArrowRightIcon: icon("arrow-right"),
		CameraIcon: icon("camera"),
		CheckCircle2Icon: icon("check-circle"),
		CheckIcon: icon("check"),
		ChevronDown: icon("chevron-down"),
		ChevronDownIcon: icon("chevron-down"),
		ChevronRightIcon: icon("chevron-right"),
		CircleIcon: icon("circle"),
		ClockIcon: icon("clock"),
		CopyIcon: icon("copy"),
		DownloadIcon: icon("download"),
		FileTextIcon: icon("file-text"),
		FilmIcon: icon("film"),
		GridIcon: icon("grid"),
		GripVerticalIcon: icon("grip-vertical"),
		ImageIcon: icon("image"),
		ListIcon: icon("list"),
		Loader2: icon("loader"),
		MapPinIcon: icon("map-pin"),
		MessageSquareIcon: icon("message-square"),
		PencilIcon: icon("pencil"),
		PlusIcon: icon("plus"),
		RotateCcwIcon: icon("rotate"),
		SearchIcon: icon("search"),
		SparklesIcon: icon("sparkles"),
		SquareIcon: icon("square"),
		Trash2Icon: icon("trash"),
		UserIcon: icon("user"),
		UsersIcon: icon("users"),
		VideoIcon: icon("video"),
		XIcon: icon("x"),
	};
});

// Mock UI components
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

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div data-testid="card" {...props}>
			{children}
		</div>
	),
	CardHeader: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div {...props}>{children}</div>
	),
	CardTitle: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div {...props}>{children}</div>
	),
	CardContent: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div {...props}>{children}</div>
	),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<span {...props}>{children}</span>
	),
}));

vi.mock("@/components/ui/progress", () => ({
	Progress: ({ value }: { value: number }) => (
		<div data-testid="progress" role="progressbar" aria-valuenow={value} />
	),
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: (props: Record<string, unknown>) => (
		<input type="checkbox" {...props} />
	),
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div data-testid="select">{children}</div>
	),
	SelectTrigger: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => (
		<span>{placeholder}</span>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	SelectGroup: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectLabel: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	DropdownMenuTrigger: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	DropdownMenuContent: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	DropdownMenuSeparator: () => <div />,
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	DialogContent: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div>{children}</div>
	),
	DialogHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DialogTitle: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DialogFooter: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@/components/ui/resizable", () => ({
	ResizablePanelGroup: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div data-testid="resizable-panel-group">{children}</div>
	),
	ResizablePanel: ({
		children,
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<div data-testid="resizable-panel">{children}</div>
	),
	ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

vi.mock("@/lib/moyin/presets/visual-styles", () => ({
	VISUAL_STYLE_PRESETS: [
		{
			id: "2d_ghibli",
			name: "Ghibli",
			category: "2d",
			mediaType: "animation",
			prompt: "ghibli style",
			negativePrompt: "",
			description: "Test style",
		},
	],
}));

vi.mock("@/lib/moyin/presets/cinematography-profiles", () => ({
	CINEMATOGRAPHY_PROFILES: [
		{
			id: "classic-cinematic",
			name: "Classic",
			emoji: "🎬",
			referenceFilms: ["Test Film"],
		},
	],
}));

vi.mock("@/lib/utils", () => ({
	cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("../batch-progress", () => ({
	BatchGenerateButtons: ({
		disabled,
	}: {
		onStart: () => void;
		disabled: boolean;
	}) => <div data-testid="batch-buttons" data-disabled={disabled} />,
	BatchProgressOverlay: () => <div data-testid="batch-overlay" />,
	useBatchGeneration: () => ({
		batch: null,
		startBatch: () => {},
		cancel: () => {},
	}),
}));

// Import components after mocks
import { MoyinView } from "../index";
import { ScriptInput } from "../script-input";
import { CharacterList } from "../character-list";
import { SceneList } from "../scene-list";
import { ShotBreakdown } from "../shot-breakdown";
import { GenerateActions } from "../generate-actions";

// ============================================================
// Helper to reset Zustand store between tests
// ============================================================
function resetStore() {
	useMoyinStore.getState().reset();
}

// ============================================================
// MoyinView — Split Panel Layout
// ============================================================

describe("MoyinView", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders the split-panel layout with header", () => {
		render(<MoyinView />);
		expect(screen.getByText("Script Editor")).toBeTruthy();
		expect(screen.getByTestId("resizable-panel-group")).toBeTruthy();
	});

	it("renders both left and right panels", () => {
		render(<MoyinView />);
		const panels = screen.getAllByTestId("resizable-panel");
		expect(panels.length).toBe(2);
	});

	it("renders the resize handle between panels", () => {
		render(<MoyinView />);
		expect(screen.getByTestId("resizable-handle")).toBeTruthy();
	});

	it("shows status text when parsing is ready", () => {
		useMoyinStore.setState({
			parseStatus: "ready",
			characters: [
				{ id: "c1", name: "Alice" },
				{ id: "c2", name: "Bob" },
			],
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
		});
		render(<MoyinView />);
		expect(screen.getByText("2 characters, 1 scenes")).toBeTruthy();
	});

	it("shows parsing status", () => {
		useMoyinStore.setState({ parseStatus: "parsing" });
		render(<MoyinView />);
		const matches = screen.getAllByText("Parsing...");
		expect(matches.length).toBeGreaterThan(0);
	});
});

// ============================================================
// ScriptInput — Import/Create Tabs + Config
// ============================================================

describe("ScriptInput", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders Import and Create tabs", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Import")).toBeTruthy();
		expect(screen.getByText("Create")).toBeTruthy();
	});

	it("renders a textarea in Import tab by default", () => {
		render(<ScriptInput />);
		const textarea = screen.getByPlaceholderText(/paste screenplay text here/i);
		expect(textarea).toBeTruthy();
	});

	it("renders the Parse Script button", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Parse Script")).toBeTruthy();
	});

	it("disables the Parse Script button when textarea is empty", () => {
		render(<ScriptInput />);
		const button = screen.getByText("Parse Script").closest("button");
		expect(button?.disabled).toBe(true);
	});

	it("enables the Parse Script button when text is entered", () => {
		useMoyinStore.setState({ rawScript: "Some script text" });
		render(<ScriptInput />);
		const button = screen.getByText("Parse Script").closest("button");
		expect(button?.disabled).toBe(false);
	});

	it("does not render clear button when textarea is empty", () => {
		render(<ScriptInput />);
		const trashIcons = screen.queryAllByTestId("icon-trash");
		expect(trashIcons).toHaveLength(0);
	});

	it("renders clear button when text is present", () => {
		useMoyinStore.setState({ rawScript: "Something" });
		render(<ScriptInput />);
		const trashIcons = screen.queryAllByTestId("icon-trash");
		expect(trashIcons.length).toBeGreaterThan(0);
	});

	it("displays error message when parseError is set", () => {
		useMoyinStore.setState({
			rawScript: "text",
			parseError: "Failed to connect to API",
			parseStatus: "error",
		});
		render(<ScriptInput />);
		expect(screen.getByText("Failed to connect to API")).toBeTruthy();
	});

	it("shows loading state while parsing", () => {
		useMoyinStore.setState({
			rawScript: "text",
			parseStatus: "parsing",
		});
		render(<ScriptInput />);
		expect(screen.getByText("Parsing...")).toBeTruthy();
	});

	it("renders helper text about AI extraction", () => {
		render(<ScriptInput />);
		expect(
			screen.getByText(
				/AI will extract characters, scenes, and story structure/
			)
		).toBeTruthy();
	});

	it("shows Create tab with genre and synopsis when clicked", () => {
		render(<ScriptInput />);
		fireEvent.click(screen.getByText("Create"));
		expect(screen.getByText("Genre")).toBeTruthy();
		expect(screen.getByText("Synopsis / Idea")).toBeTruthy();
		expect(screen.getByText("Generate Script")).toBeTruthy();
	});

	it("renders language selector in configuration", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Language")).toBeTruthy();
	});

	it("renders scene count and shot count selectors", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Scene Count")).toBeTruthy();
		expect(screen.getByText("Shot Count")).toBeTruthy();
	});

	it("renders visual style selector", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Visual Style")).toBeTruthy();
	});

	it("renders camera profile selector", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Camera Profile")).toBeTruthy();
	});

	it("shows API key warning when not configured", () => {
		useMoyinStore.setState({ chatConfigured: false });
		render(<ScriptInput />);
		expect(screen.getByText("API Not Configured")).toBeTruthy();
	});

	it("hides API key warning when configured", () => {
		useMoyinStore.setState({ chatConfigured: true });
		render(<ScriptInput />);
		expect(screen.queryByText("API Not Configured")).toBeNull();
	});
});

// ============================================================
// CharacterList — Search Filter
// ============================================================

describe("CharacterList — Search", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders search input when characters exist", () => {
		useMoyinStore.setState({
			characters: [
				{ id: "c1", name: "Alice" },
				{ id: "c2", name: "Bob" },
			],
		});
		render(<CharacterList />);
		expect(screen.getByPlaceholderText("Search characters...")).toBeTruthy();
	});

	it("does not render search when no characters", () => {
		render(<CharacterList />);
		expect(screen.queryByPlaceholderText("Search characters...")).toBeNull();
	});

	it("filters characters by name", () => {
		useMoyinStore.setState({
			characters: [
				{ id: "c1", name: "Alice" },
				{ id: "c2", name: "Bob" },
			],
		});
		render(<CharacterList />);
		const input = screen.getByPlaceholderText("Search characters...");
		fireEvent.change(input, { target: { value: "alice" } });
		expect(screen.getByText("Alice")).toBeTruthy();
		expect(screen.queryByText("Bob")).toBeNull();
	});
});

// ============================================================
// SceneList — Search Filter
// ============================================================

describe("SceneList — Search", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders search input when scenes exist", () => {
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
		});
		render(<SceneList />);
		expect(screen.getByPlaceholderText("Search scenes...")).toBeTruthy();
	});

	it("filters scenes by location", () => {
		useMoyinStore.setState({
			scenes: [
				{ id: "s1", location: "Park", time: "Day", atmosphere: "" },
				{ id: "s2", location: "Office", time: "Night", atmosphere: "" },
			],
		});
		render(<SceneList />);
		const input = screen.getByPlaceholderText("Search scenes...");
		fireEvent.change(input, { target: { value: "park" } });
		expect(screen.getByText("Park")).toBeTruthy();
		expect(screen.queryByText("Office")).toBeNull();
	});
});

// ============================================================
// ShotBreakdown — Grid/List Toggle
// ============================================================

describe("ShotBreakdown — View Toggle", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders view toggle buttons when shots exist", () => {
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Test shot",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
		render(<ShotBreakdown />);
		expect(screen.getByLabelText("List view")).toBeTruthy();
		expect(screen.getByLabelText("Grid view")).toBeTruthy();
	});

	it("shows shot count text", () => {
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Test shot",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
		render(<ShotBreakdown />);
		expect(screen.getByText("1 shot")).toBeTruthy();
	});
});

// ============================================================
// GenerateActions — Export & Completion Stats
// ============================================================

describe("GenerateActions — Export & Stats", () => {
	beforeEach(() => {
		resetStore();
	});

	it("shows completion stats when shots exist", () => {
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Test",
					characterIds: [],
					characterVariations: {},
					imageStatus: "completed",
					imageProgress: 100,
					videoStatus: "idle",
					videoProgress: 0,
				},
				{
					id: "shot2",
					index: 1,
					sceneRefId: "s1",
					actionSummary: "Test 2",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
		render(<GenerateActions />);
		expect(screen.getByText("Images: 1/2")).toBeTruthy();
		expect(screen.getByText("Videos: 0/2")).toBeTruthy();
	});

	it("shows export button when done", () => {
		useMoyinStore.setState({
			generationStatus: "done",
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Test",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
		render(<GenerateActions />);
		expect(screen.getByText("Export")).toBeTruthy();
	});
});
