import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMoyinStore } from "@/stores/moyin-store";

// Mock lucide-react icons as simple spans
vi.mock("lucide-react", () => {
	const icon = (name: string) => (props: Record<string, unknown>) => (
		<span data-testid={`icon-${name}`} {...props} />
	);
	return {
		FileTextIcon: icon("file-text"),
		UsersIcon: icon("users"),
		MapPinIcon: icon("map-pin"),
		SparklesIcon: icon("sparkles"),
		Loader2: icon("loader"),
		Trash2Icon: icon("trash"),
		ArrowLeftIcon: icon("arrow-left"),
		ArrowRightIcon: icon("arrow-right"),
		UserIcon: icon("user"),
		CheckCircle2Icon: icon("check-circle"),
		RotateCcwIcon: icon("rotate"),
		PlusIcon: icon("plus"),
		PencilIcon: icon("pencil"),
		CheckIcon: icon("check"),
		XIcon: icon("x"),
		ChevronDown: icon("chevron-down"),
	};
});

// Mock UI components to simple HTML elements
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

vi.mock("@/components/ui/label", () => ({
	Label: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => (
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

// Mock cn utility
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
// MoyinView
// ============================================================

describe("MoyinView", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders the step indicator with all four step labels", () => {
		render(<MoyinView />);
		expect(screen.getByText("Script")).toBeTruthy();
		expect(screen.getByText("Characters")).toBeTruthy();
		expect(screen.getByText("Scenes")).toBeTruthy();
		expect(screen.getByText("Generate")).toBeTruthy();
	});

	it("renders the ScriptInput component by default (script step)", () => {
		render(<MoyinView />);
		// ScriptInput renders a textarea
		expect(
			screen.getByPlaceholderText(/paste screenplay text here/i)
		).toBeTruthy();
	});

	it("renders CharacterList when activeStep is characters", () => {
		// Set store to ready + characters step
		useMoyinStore.setState({
			activeStep: "characters",
			parseStatus: "ready",
			characters: [],
		});
		render(<MoyinView />);
		expect(screen.getByText("0 characters extracted")).toBeTruthy();
	});

	it("renders SceneList when activeStep is scenes", () => {
		useMoyinStore.setState({
			activeStep: "scenes",
			parseStatus: "ready",
			scenes: [],
		});
		render(<MoyinView />);
		expect(screen.getByText("0 scenes extracted")).toBeTruthy();
	});

	it("renders GenerateActions when activeStep is generate", () => {
		useMoyinStore.setState({
			activeStep: "generate",
			parseStatus: "ready",
			scenes: [],
			characters: [],
		});
		render(<MoyinView />);
		expect(screen.getByText("Storyboard Summary")).toBeTruthy();
	});
});

// ============================================================
// ScriptInput
// ============================================================

describe("ScriptInput", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders a textarea", () => {
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

	it("enables the Parse Script button when text is entered", async () => {
		useMoyinStore.setState({ rawScript: "Some script text" });
		render(<ScriptInput />);
		const button = screen.getByText("Parse Script").closest("button");
		expect(button?.disabled).toBe(false);
	});

	it("does not render clear button when textarea is empty", () => {
		render(<ScriptInput />);
		// The trash icon button should not be present when rawScript is empty
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
});

// ============================================================
// Step Navigation
// ============================================================

describe("Step Navigation", () => {
	beforeEach(() => {
		resetStore();
	});

	it("clicking Script step button navigates to script step", () => {
		// Start on characters step with ready status
		useMoyinStore.setState({
			activeStep: "characters",
			parseStatus: "ready",
		});
		render(<MoyinView />);

		// Multiple "Script" texts exist (step indicator + CharacterList back button).
		// Target the one in the step indicator (wrapped in a <span> inside the step button).
		const scriptButtons = screen.getAllByText("Script");
		// The first one is in the step indicator
		fireEvent.click(scriptButtons[0]);

		expect(useMoyinStore.getState().activeStep).toBe("script");
	});

	it("disables non-script step buttons when parse is not ready", () => {
		useMoyinStore.setState({
			activeStep: "script",
			parseStatus: "idle",
		});
		render(<MoyinView />);

		const charactersButton = screen.getByText("Characters").closest("button");
		const scenesButton = screen.getByText("Scenes").closest("button");
		const generateButton = screen.getByText("Generate").closest("button");

		expect(charactersButton?.disabled).toBe(true);
		expect(scenesButton?.disabled).toBe(true);
		expect(generateButton?.disabled).toBe(true);
	});

	it("enables all step buttons when parse is ready", () => {
		useMoyinStore.setState({
			activeStep: "script",
			parseStatus: "ready",
		});
		render(<MoyinView />);

		const scriptButton = screen.getByText("Script").closest("button");
		const charactersButton = screen.getByText("Characters").closest("button");
		const scenesButton = screen.getByText("Scenes").closest("button");
		const generateButton = screen.getByText("Generate").closest("button");

		expect(scriptButton?.disabled).toBe(false);
		expect(charactersButton?.disabled).toBe(false);
		expect(scenesButton?.disabled).toBe(false);
		expect(generateButton?.disabled).toBe(false);
	});

	it("clicking Characters step button navigates when ready", () => {
		useMoyinStore.setState({
			activeStep: "script",
			parseStatus: "ready",
		});
		render(<MoyinView />);

		fireEvent.click(screen.getByText("Characters"));

		expect(useMoyinStore.getState().activeStep).toBe("characters");
	});

	it("clicking Scenes step button navigates when ready", () => {
		useMoyinStore.setState({
			activeStep: "script",
			parseStatus: "ready",
		});
		render(<MoyinView />);

		fireEvent.click(screen.getByText("Scenes"));

		expect(useMoyinStore.getState().activeStep).toBe("scenes");
	});

	it("clicking Generate step button navigates when ready", () => {
		useMoyinStore.setState({
			activeStep: "script",
			parseStatus: "ready",
		});
		render(<MoyinView />);

		fireEvent.click(screen.getByText("Generate"));

		expect(useMoyinStore.getState().activeStep).toBe("generate");
	});
});
