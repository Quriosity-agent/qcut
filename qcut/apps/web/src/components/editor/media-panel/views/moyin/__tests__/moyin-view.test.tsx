import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMoyinStore } from "@/stores/moyin-store";

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
		CopyIcon: icon("copy"),
		DownloadIcon: icon("download"),
		FileTextIcon: icon("file-text"),
		FilmIcon: icon("film"),
		GripVerticalIcon: icon("grip-vertical"),
		ImageIcon: icon("image"),
		Loader2: icon("loader"),
		MapPinIcon: icon("map-pin"),
		MessageSquareIcon: icon("message-square"),
		PencilIcon: icon("pencil"),
		PlusIcon: icon("plus"),
		RotateCcwIcon: icon("rotate"),
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

// Import components after mocks
import { MoyinView } from "../index";
import { ScriptInput } from "../script-input";

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

	it("shows Create tab placeholder when clicked", () => {
		render(<ScriptInput />);
		fireEvent.click(screen.getByText("Create"));
		expect(screen.getByText("AI Script Creation")).toBeTruthy();
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
