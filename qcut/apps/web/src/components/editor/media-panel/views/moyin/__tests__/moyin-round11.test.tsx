/**
 * Tests for Round 11: progress bars, inline episode editing, onboarding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMoyinStore } from "@/stores/moyin/moyin-store";

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
	useParams: () => ({ project_id: "" }),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => {
	const icon = (name: string) => (props: Record<string, unknown>) => (
		<span data-testid={`icon-${name}`} {...props} />
	);
	return {
		AlertTriangleIcon: icon("alert-triangle"),
		BookOpenIcon: icon("book-open"),
		ArrowLeftIcon: icon("arrow-left"),
		ArrowRightIcon: icon("arrow-right"),
		CameraIcon: icon("camera"),
		ClipboardCopyIcon: icon("clipboard-copy"),
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
		FilterIcon: icon("filter"),
		FilmIcon: icon("film"),
		GridIcon: icon("grid"),
		GripVerticalIcon: icon("grip-vertical"),
		ImageIcon: icon("image"),
		ListIcon: icon("list"),
		Loader2: icon("loader"),
		MapPinIcon: icon("map-pin"),
		MessageSquareIcon: icon("message-square"),
		MoreHorizontalIcon: icon("more-horizontal"),
		PencilIcon: icon("pencil"),
		PlusIcon: icon("plus"),
		RotateCcwIcon: icon("rotate"),
		SearchIcon: icon("search"),
		SparklesIcon: icon("sparkles"),
		SquareIcon: icon("square"),
		Trash2Icon: icon("trash"),
		UploadIcon: icon("upload"),
		UserIcon: icon("user"),
		UsersIcon: icon("users"),
		VideoIcon: icon("video"),
		XIcon: icon("x"),
		ZapIcon: icon("zap"),
		// Media panel store tab icons (transitive import via moyin-parse-actions)
		ArrowLeftRightIcon: icon("arrow-left-right"),
		ArrowUpFromLineIcon: icon("arrow-up-from-line"),
		BlendIcon: icon("blend"),
		BotIcon: icon("bot"),
		ClapperboardIcon: icon("clapperboard"),
		FolderOpenIcon: icon("folder-open"),
		FolderSync: icon("folder-sync"),
		Layers: icon("layers"),
		PaletteIcon: icon("palette"),
		ScissorsIcon: icon("scissors"),
		SquareTerminalIcon: icon("square-terminal"),
		StickerIcon: icon("sticker"),
		TextSelect: icon("text-select"),
		TypeIcon: icon("type"),
		VolumeXIcon: icon("volume-x"),
		Wand2Icon: icon("wand-2"),
		WandIcon: icon("wand"),
		WrenchIcon: icon("wrench"),
	};
});

// Mock UI components
vi.mock("@/lib/utils", () => ({
	cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
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

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: { children: React.ReactNode }) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		className?: string;
		onKeyDown?: (e: React.KeyboardEvent) => void;
	}) => <div {...props}>{children}</div>,
	CardContent: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		className?: string;
	}) => <div {...props}>{children}</div>,
	CardHeader: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		className?: string;
	}) => <div {...props}>{children}</div>,
	CardTitle: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		className?: string;
	}) => <div {...props}>{children}</div>,
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

vi.mock("@/components/ui/progress", () => ({
	Progress: ({ value, className }: { value: number; className?: string }) => (
		<div
			role="progressbar"
			aria-valuenow={value}
			className={className}
			data-testid="progress-bar"
		/>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectGroup: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({
		children,
		value,
	}: {
		children: React.ReactNode;
		value: string;
	}) => <option value={value}>{children}</option>,
	SelectLabel: ({ children }: { children: React.ReactNode }) => (
		<label>{children}</label>
	),
	SelectTrigger: ({ children }: { children: React.ReactNode }) => (
		<button type="button">{children}</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => (
		<span>{placeholder}</span>
	),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({
		children,
		onClick,
	}: {
		children: React.ReactNode;
		onClick?: () => void;
	}) => (
		<button type="button" onClick={onClick}>
			{children}
		</button>
	),
	DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@/lib/moyin/script/example-scripts", () => ({
	EXAMPLE_SCRIPTS: [
		{
			id: "test-example",
			label: "Test Example",
			language: "English",
			description: "Test script",
			content: "Test content",
			structure: {
				scriptData: {
					title: "Test",
					language: "English",
					characters: [],
					scenes: [],
					episodes: [],
					storyParagraphs: [],
				},
				characters: [],
				scenes: [],
				episodes: [],
				shots: [],
			},
		},
	],
}));

vi.mock("@/lib/moyin/presets/visual-styles", () => ({
	VISUAL_STYLE_PRESETS: [{ id: "2d_ghibli", name: "Ghibli", category: "2D" }],
}));

vi.mock("@/lib/moyin/presets/cinematography-profiles", () => ({
	CINEMATOGRAPHY_PROFILES: [
		{ id: "classic-cinematic", name: "Classic Cinematic" },
	],
}));

vi.mock("@/stores/moyin/moyin-shot-generation", () => ({
	isModerationError: () => false,
}));

vi.mock("../tree-context-menu", () => ({
	EpisodeContextMenu: () => null,
	SceneContextMenu: () => null,
	ShotContextMenu: () => null,
}));

vi.mock("../episode-dialog", () => ({
	EpisodeDialog: () => null,
}));

vi.mock("../import-progress", () => ({
	ImportProgress: () => null,
}));

vi.mock("../prompt-editor", () => ({
	PromptEditor: () => null,
}));

vi.mock("../cinema-selectors", () => ({
	LightingSelector: () => null,
	FocusSelector: () => null,
	RigSelector: () => null,
	AtmosphereSelector: () => null,
	SpeedSelector: () => null,
	AngleSelector: () => null,
	FocalLengthSelector: () => null,
	TechniqueSelector: () => null,
}));

vi.mock("../shot-selectors", () => ({
	ShotSizeSelector: () => null,
	DurationSelector: () => null,
	EmotionTagSelector: () => null,
	SoundDesignInput: () => null,
}));

vi.mock("../collapsible-section", () => ({
	CollapsibleSection: ({
		children,
		title,
	}: {
		children: React.ReactNode;
		title: string;
	}) => <div data-testid={`section-${title}`}>{children}</div>,
}));

vi.mock("../media-preview-modal", () => ({
	MediaPreviewModal: () => null,
}));

vi.mock("../batch-progress", () => ({
	BatchGenerateButtons: () => null,
	BatchProgressOverlay: () => null,
	useBatchGeneration: () => ({
		batch: null,
		startBatch: vi.fn(),
		cancel: vi.fn(),
	}),
}));

vi.mock("@/stores/moyin/moyin-persistence", () => ({
	exportProjectJSON: vi.fn(),
	parseImportedProjectJSON: vi.fn(),
	partializeMoyinState: vi.fn(),
}));

function resetStore() {
	useMoyinStore.setState({
		projectId: null,
		activeStep: "script",
		rawScript: "",
		scriptData: null,
		parseStatus: "idle",
		parseError: null,
		language: "English",
		sceneCount: "auto",
		shotCount: "auto",
		chatConfigured: true,
		characters: [],
		scenes: [],
		shots: [],
		shotGenerationStatus: {},
		episodes: [],
		selectedItemId: null,
		selectedItemType: null,
		generationStatus: "idle",
		generationProgress: 0,
		generationError: null,
		characterCalibrationStatus: "idle",
		sceneCalibrationStatus: "idle",
		calibrationError: null,
		selectedStyleId: "2d_ghibli",
		selectedProfileId: "classic-cinematic",
		storyboardImageUrl: null,
		storyboardGridConfig: null,
		createStatus: "idle",
		createError: null,
		selectedShotIds: new Set<string>(),
	});
}

// ==================== Onboarding Card ====================

import { ScriptInput } from "../script-input";

describe("ScriptInput — Onboarding", () => {
	beforeEach(resetStore);

	it("shows workflow guide when no script and idle", () => {
		render(<ScriptInput />);
		expect(screen.getByText("Quick Start")).toBeTruthy();
	});

	it("hides workflow guide when script is entered", () => {
		useMoyinStore.setState({ rawScript: "Some script text" });
		render(<ScriptInput />);
		expect(screen.queryByText("Quick Start")).toBeNull();
	});

	it("hides workflow guide during parsing", () => {
		useMoyinStore.setState({ parseStatus: "parsing" });
		render(<ScriptInput />);
		expect(screen.queryByText("Quick Start")).toBeNull();
	});
});

// ==================== Episode Inline Editing ====================

import { EpisodeTree } from "../episode-tree";

describe("EpisodeTree — Inline Editing", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			scriptData: {
				title: "Test",
				language: "English",
				characters: [],
				scenes: [],
				episodes: [],
				storyParagraphs: [],
			},
			episodes: [{ id: "ep1", index: 0, title: "Episode 1", sceneIds: ["s1"] }],
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [],
		});
	});

	it("shows inline edit input on double-click", () => {
		render(<EpisodeTree />);
		const epButton = screen.getByText("Episode 1").closest("button");
		expect(epButton).toBeTruthy();
		fireEvent.doubleClick(epButton!);
		expect(screen.getByLabelText("Edit episode title")).toBeTruthy();
	});

	it("saves on Enter key", () => {
		render(<EpisodeTree />);
		const epButton = screen.getByText("Episode 1").closest("button");
		fireEvent.doubleClick(epButton!);
		const input = screen.getByLabelText("Edit episode title");
		fireEvent.change(input, { target: { value: "Renamed Episode" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(useMoyinStore.getState().episodes[0].title).toBe("Renamed Episode");
	});

	it("cancels on Escape key", () => {
		render(<EpisodeTree />);
		const epButton = screen.getByText("Episode 1").closest("button");
		fireEvent.doubleClick(epButton!);
		const input = screen.getByLabelText("Edit episode title");
		fireEvent.change(input, { target: { value: "Changed" } });
		fireEvent.keyDown(input, { key: "Escape" });
		// Should not have saved
		expect(useMoyinStore.getState().episodes[0].title).toBe("Episode 1");
	});
});

// ==================== Round 12: Scene Inline Editing ====================

describe("EpisodeTree — Scene Inline Editing", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			scriptData: {
				title: "Test",
				language: "English",
				characters: [],
				scenes: [],
				episodes: [],
				storyParagraphs: [],
			},
			episodes: [{ id: "ep1", index: 0, title: "Episode 1", sceneIds: ["s1"] }],
			scenes: [
				{
					id: "s1",
					location: "Park",
					name: "Park Scene",
					time: "Day",
					atmosphere: "",
				},
			],
			shots: [],
		});
	});

	it("shows inline edit input on scene double-click", () => {
		render(<EpisodeTree />);
		// Expand episode first
		fireEvent.click(screen.getByText("Episode 1"));
		const sceneButton = screen.getByText("Park Scene").closest("button");
		expect(sceneButton).toBeTruthy();
		fireEvent.doubleClick(sceneButton!);
		expect(screen.getByLabelText("Edit scene name")).toBeTruthy();
	});

	it("saves scene name on Enter", () => {
		render(<EpisodeTree />);
		fireEvent.click(screen.getByText("Episode 1"));
		const sceneButton = screen.getByText("Park Scene").closest("button");
		fireEvent.doubleClick(sceneButton!);
		const input = screen.getByLabelText("Edit scene name");
		fireEvent.change(input, { target: { value: "Forest Scene" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(useMoyinStore.getState().scenes[0].name).toBe("Forest Scene");
	});

	it("cancels scene rename on Escape", () => {
		render(<EpisodeTree />);
		fireEvent.click(screen.getByText("Episode 1"));
		const sceneButton = screen.getByText("Park Scene").closest("button");
		fireEvent.doubleClick(sceneButton!);
		const input = screen.getByLabelText("Edit scene name");
		fireEvent.change(input, { target: { value: "Different" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(useMoyinStore.getState().scenes[0].name).toBe("Park Scene");
	});
});

// ==================== Round 13: Expand/Collapse All Episodes ====================

describe("EpisodeTree — Expand/Collapse All", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			scriptData: {
				title: "Test",
				language: "English",
				characters: [],
				scenes: [],
				episodes: [],
				storyParagraphs: [],
			},
			episodes: [
				{ id: "ep1", index: 0, title: "Episode 1", sceneIds: ["s1"] },
				{ id: "ep2", index: 1, title: "Episode 2", sceneIds: ["s2"] },
			],
			scenes: [
				{
					id: "s1",
					location: "Park",
					name: "Park Scene",
					time: "Day",
					atmosphere: "",
				},
				{
					id: "s2",
					location: "Beach",
					name: "Beach Scene",
					time: "Night",
					atmosphere: "",
				},
			],
			shots: [],
		});
	});

	it("shows expand/collapse buttons when multiple episodes", () => {
		render(<EpisodeTree />);
		expect(screen.getByLabelText("Expand all episodes")).toBeTruthy();
		expect(screen.getByLabelText("Collapse all episodes")).toBeTruthy();
	});

	it("does not show buttons with single episode", () => {
		useMoyinStore.setState({
			episodes: [{ id: "ep1", index: 0, title: "Episode 1", sceneIds: ["s1"] }],
		});
		render(<EpisodeTree />);
		expect(screen.queryByLabelText("Expand all episodes")).toBeNull();
	});

	it("expands all episodes on click", () => {
		render(<EpisodeTree />);
		fireEvent.click(screen.getByLabelText("Expand all episodes"));
		// Both scenes should now be visible
		expect(screen.getByText("Park Scene")).toBeTruthy();
		expect(screen.getByText("Beach Scene")).toBeTruthy();
	});

	it("collapses all episodes on click", () => {
		render(<EpisodeTree />);
		// First expand all
		fireEvent.click(screen.getByLabelText("Expand all episodes"));
		expect(screen.getByText("Park Scene")).toBeTruthy();
		// Now collapse all
		fireEvent.click(screen.getByLabelText("Collapse all episodes"));
		expect(screen.queryByText("Park Scene")).toBeNull();
		expect(screen.queryByText("Beach Scene")).toBeNull();
	});
});

// ==================== Round 12: Shot Stats Progress Bars ====================

import { GenerateActions } from "../generate-actions";

describe("GenerateActions — Shot Stats Progress Bars", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Walk",
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
					actionSummary: "Run",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
	});

	it("shows image progress bar when some images completed", () => {
		render(<GenerateActions />);
		expect(screen.getByText("Img")).toBeTruthy();
	});

	it("does not show progress bars when no completions", () => {
		useMoyinStore.setState({
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Walk",
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
		expect(screen.queryByText("Img")).toBeNull();
	});
});

// ==================== Round 14: Character Filter Pills ====================

describe("EpisodeTree — Character Filter Pills", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			scriptData: {
				title: "Test",
				language: "English",
				characters: [],
				scenes: [],
				episodes: [],
				storyParagraphs: [],
			},
			episodes: [
				{ id: "ep1", index: 0, title: "Episode 1", sceneIds: ["s1", "s2"] },
			],
			scenes: [
				{
					id: "s1",
					location: "Park",
					name: "Park Scene",
					time: "Day",
					atmosphere: "",
				},
				{
					id: "s2",
					location: "Beach",
					name: "Beach Scene",
					time: "Night",
					atmosphere: "",
				},
			],
			characters: [
				{ id: "c1", name: "Alice", role: "lead" },
				{ id: "c2", name: "Bob", role: "support" },
			],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Walk",
					characterIds: ["c1"],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
				{
					id: "shot2",
					index: 1,
					sceneRefId: "s2",
					actionSummary: "Swim",
					characterIds: ["c2"],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
	});

	it("renders character filter pills when characters exist", () => {
		render(<EpisodeTree />);
		expect(screen.getByLabelText("Character filter")).toBeTruthy();
		expect(screen.getByText("Alice")).toBeTruthy();
		expect(screen.getByText("Bob")).toBeTruthy();
	});

	it("filters tree by character when pill is clicked", () => {
		render(<EpisodeTree />);
		// Expand the episode
		fireEvent.click(screen.getByText("Episode 1"));
		// Both scenes visible before filter
		expect(screen.getByText("Park Scene")).toBeTruthy();
		expect(screen.getByText("Beach Scene")).toBeTruthy();
		// Click Alice filter — only scenes with Alice's shots should show
		fireEvent.click(screen.getByText("Alice"));
		expect(screen.getByText("Park Scene")).toBeTruthy();
		expect(screen.queryByText("Beach Scene")).toBeNull();
	});

	it("clears character filter on All click", () => {
		render(<EpisodeTree />);
		fireEvent.click(screen.getByText("Episode 1"));
		// Apply filter
		fireEvent.click(screen.getByText("Alice"));
		expect(screen.queryByText("Beach Scene")).toBeNull();
		// Clear filter by clicking All
		const allButtons = screen.getAllByText("All");
		// The character filter "All" button
		const charFilterAll = allButtons.find(
			(el) => el.closest("[aria-label='Character filter']") !== null
		);
		expect(charFilterAll).toBeTruthy();
		fireEvent.click(charFilterAll!);
		expect(screen.getByText("Beach Scene")).toBeTruthy();
	});
});

// ==================== Round 16: CharacterList & SceneList Improvements ====================

import { CharacterList } from "../character-list";
import { SceneList } from "../scene-list";

describe("CharacterList — Accessibility & Keyboard", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			characters: [{ id: "c1", name: "Alice", role: "lead" }],
		});
	});

	it("has aria-label on Add button", () => {
		render(<CharacterList />);
		expect(screen.getByLabelText("Add character")).toBeTruthy();
	});

	it("shows edit form with cancel on edit click", () => {
		render(<CharacterList />);
		const editBtn = screen.getByLabelText("Edit Alice");
		fireEvent.click(editBtn);
		expect(screen.getByText("Save")).toBeTruthy();
		expect(screen.getByText("Cancel")).toBeTruthy();
	});
});

describe("SceneList — Accessibility", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			parseStatus: "ready",
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
		});
	});

	it("has aria-label on Add button", () => {
		render(<SceneList />);
		expect(screen.getByLabelText("Add scene")).toBeTruthy();
	});
});

// ==================== Round 17: Shot Breakdown Enhancements ====================

import { ShotBreakdown } from "../shot-breakdown";

describe("ShotBreakdown — Bulk Actions", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero walks",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
				{
					id: "shot2",
					index: 1,
					sceneRefId: "s1",
					actionSummary: "Villain appears",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
			selectedShotIds: new Set(["shot1"]),
		});
	});

	it("shows Duplicate button in bulk action bar", () => {
		render(<ShotBreakdown />);
		expect(screen.getByLabelText("Duplicate selected shots")).toBeTruthy();
	});

	it("shows Generate button in bulk action bar", () => {
		render(<ShotBreakdown />);
		expect(
			screen.getByLabelText("Generate images for selected shots")
		).toBeTruthy();
	});
});

describe("ShotBreakdown — Narrative Badges", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero walks",
					narrativeFunction: "climax",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
		});
	});

	it("shows narrative function badge in list view", () => {
		render(<ShotBreakdown />);
		expect(screen.getByText("CL")).toBeTruthy();
		expect(screen.getByTitle("climax")).toBeTruthy();
	});
});

describe("ShotBreakdown — Bulk Copy Prompts", () => {
	beforeEach(() => {
		resetStore();
		useMoyinStore.setState({
			scenes: [{ id: "s1", location: "Park", time: "Day", atmosphere: "" }],
			shots: [
				{
					id: "shot1",
					index: 0,
					sceneRefId: "s1",
					actionSummary: "Hero walks",
					characterIds: [],
					characterVariations: {},
					imageStatus: "idle",
					imageProgress: 0,
					videoStatus: "idle",
					videoProgress: 0,
				},
			],
			selectedShotIds: new Set(["shot1"]),
		});
	});

	it("shows Copy button in bulk action bar", () => {
		render(<ShotBreakdown />);
		expect(
			screen.getByLabelText("Copy prompts for selected shots")
		).toBeTruthy();
	});
});

// Round 21 tests are in moyin-round21.test.tsx (separate file to avoid mock conflicts)
