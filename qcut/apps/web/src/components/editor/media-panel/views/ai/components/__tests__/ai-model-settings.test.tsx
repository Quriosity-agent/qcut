import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

// Mock shadcn Select — render a native <select> for testability
vi.mock("@/components/ui/select", () => ({
	Select: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (v: string) => void;
		children: React.ReactNode;
	}) => (
		<select
			data-testid="mock-select"
			value={value}
			onChange={(e) => onValueChange(e.target.value)}
		>
			{children}
		</select>
	),
	SelectTrigger: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => (
		<option value="">{placeholder}</option>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
	SelectItem: ({
		value,
		children,
	}: {
		value: string;
		children: React.ReactNode;
	}) => <option value={value}>{children}</option>,
}));

// Mock Checkbox
vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: ({
		id,
		checked,
		onCheckedChange,
	}: {
		id: string;
		checked: boolean;
		onCheckedChange: (v: boolean) => void;
	}) => (
		<input
			data-testid={`checkbox-${id}`}
			type="checkbox"
			checked={checked}
			onChange={(e) => onCheckedChange(e.target.checked)}
		/>
	),
}));

// Mock Label
vi.mock("@/components/ui/label", () => ({
	Label: ({
		children,
		...props
	}: { children: React.ReactNode } & Record<string, unknown>) => (
		<label {...props}>{children}</label>
	),
}));

// Mock Textarea
vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: Record<string, unknown>) => (
		<textarea data-testid="mock-textarea" {...props} />
	),
}));

// Mock Input
vi.mock("@/components/ui/input", () => ({
	Input: (props: Record<string, unknown>) => (
		<input data-testid="mock-input" {...props} />
	),
}));

// Mock FileUpload
vi.mock("@/components/ui/file-upload", () => ({
	FileUpload: ({ id, label }: { id: string; label: string }) => (
		<div data-testid={`file-upload-${id}`}>{label}</div>
	),
}));

// ---------------------------------------------------------------------------
// AiViduQ2Settings
// ---------------------------------------------------------------------------
describe("AiViduQ2Settings", () => {
	async function renderVidu(overrides = {}) {
		const { AiViduQ2Settings } = await import("../ai-vidu-q2-settings");
		const props = {
			duration: 4 as const,
			onDurationChange: vi.fn(),
			resolution: "720p" as const,
			onResolutionChange: vi.fn(),
			movementAmplitude: "auto" as const,
			onMovementAmplitudeChange: vi.fn(),
			bgm: false,
			onBgmChange: vi.fn(),
			isCompact: false,
			...overrides,
		};
		return { ...render(<AiViduQ2Settings {...props} />), props };
	}

	it("renders duration select with options", async () => {
		await renderVidu();
		const selects = screen.getAllByTestId("mock-select");
		expect(selects.length).toBeGreaterThanOrEqual(1);
		// Duration select should contain "2 seconds" through "8 seconds"
		expect(screen.getByText("2 seconds")).toBeTruthy();
		expect(screen.getByText("8 seconds")).toBeTruthy();
	});

	it("renders BGM checkbox when duration is 4", async () => {
		await renderVidu({ duration: 4 });
		expect(screen.getByTestId("checkbox-vidu-bgm")).toBeTruthy();
	});

	it("hides BGM checkbox when duration is not 4", async () => {
		await renderVidu({ duration: 5 });
		expect(screen.queryByTestId("checkbox-vidu-bgm")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// AiKlingV25Settings
// ---------------------------------------------------------------------------
describe("AiKlingV25Settings", () => {
	async function renderKling25(overrides = {}) {
		const { AiKlingV25Settings } = await import("../ai-kling-v25-settings");
		const props = {
			duration: 5 as const,
			onDurationChange: vi.fn(),
			aspectRatio: "16:9" as const,
			onAspectRatioChange: vi.fn(),
			cfgScale: 0.5,
			onCfgScaleChange: vi.fn(),
			enhancePrompt: false,
			onEnhancePromptChange: vi.fn(),
			negativePrompt: "",
			onNegativePromptChange: vi.fn(),
			isCompact: false,
			...overrides,
		};
		return { ...render(<AiKlingV25Settings {...props} />), props };
	}

	it("renders CFG slider", async () => {
		await renderKling25();
		const slider = document.querySelector('input[type="range"]');
		expect(slider).toBeTruthy();
		expect(slider?.getAttribute("min")).toBe("0");
		expect(slider?.getAttribute("max")).toBe("1");
	});

	it("renders negative prompt textarea", async () => {
		await renderKling25();
		expect(screen.getByTestId("mock-textarea")).toBeTruthy();
	});

	it("renders enhance prompt checkbox", async () => {
		await renderKling25();
		expect(screen.getByTestId("checkbox-kling-enhance-prompt")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AiSeedanceSettings
// ---------------------------------------------------------------------------
describe("AiSeedanceSettings", () => {
	async function renderSeedance(overrides = {}) {
		const { AiSeedanceSettings } = await import("../ai-seedance-settings");
		const props = {
			duration: 5 as const,
			onDurationChange: vi.fn(),
			resolution: "720p" as const,
			onResolutionChange: vi.fn(),
			aspectRatio: "16:9" as const,
			onAspectRatioChange: vi.fn(),
			cameraFixed: false,
			onCameraFixedChange: vi.fn(),
			endFrameUrl: undefined,
			onEndFrameUrlChange: vi.fn(),
			endFrameFile: null,
			endFramePreview: null,
			onEndFrameFileChange: vi.fn(),
			isProSelected: false,
			isCompact: false,
			onError: vi.fn(),
			...overrides,
		};
		return { ...render(<AiSeedanceSettings {...props} />), props };
	}

	it("renders end frame upload when Pro is selected", async () => {
		await renderSeedance({ isProSelected: true });
		expect(
			screen.getByTestId("file-upload-seedance-end-frame-upload")
		).toBeTruthy();
	});

	it("hides end frame upload when Pro is not selected", async () => {
		await renderSeedance({ isProSelected: false });
		expect(
			screen.queryByTestId("file-upload-seedance-end-frame-upload")
		).toBeNull();
	});

	it("renders camera lock checkbox", async () => {
		await renderSeedance();
		expect(screen.getByTestId("checkbox-seedance-camera-fixed")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AiWan25Settings
// ---------------------------------------------------------------------------
describe("AiWan25Settings", () => {
	async function renderWan25(overrides = {}) {
		const { AiWan25Settings } = await import("../ai-wan25-settings");
		const props = {
			duration: 5 as const,
			onDurationChange: vi.fn(),
			resolution: "480p" as const,
			onResolutionChange: vi.fn(),
			enablePromptExpansion: false,
			onEnablePromptExpansionChange: vi.fn(),
			negativePrompt: "",
			onNegativePromptChange: vi.fn(),
			audioUrl: undefined,
			onAudioUrlChange: vi.fn(),
			audioFile: null,
			audioPreview: null,
			onAudioFileChange: vi.fn(),
			isCompact: false,
			onError: vi.fn(),
			...overrides,
		};
		return { ...render(<AiWan25Settings {...props} />), props };
	}

	it("renders audio upload section", async () => {
		await renderWan25();
		expect(screen.getByTestId("file-upload-wan25-audio-upload")).toBeTruthy();
	});

	it("renders prompt expansion checkbox", async () => {
		await renderWan25();
		expect(screen.getByTestId("checkbox-wan25-enhance-prompt")).toBeTruthy();
	});

	it("renders negative prompt textarea", async () => {
		await renderWan25();
		expect(screen.getByTestId("mock-textarea")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// All components render without crash
// ---------------------------------------------------------------------------
describe("Each component renders without crash", () => {
	it("AiViduQ2Settings", async () => {
		const { AiViduQ2Settings } = await import("../ai-vidu-q2-settings");
		expect(() =>
			render(
				<AiViduQ2Settings
					duration={4}
					onDurationChange={vi.fn()}
					resolution="720p"
					onResolutionChange={vi.fn()}
					movementAmplitude="auto"
					onMovementAmplitudeChange={vi.fn()}
					bgm={false}
					onBgmChange={vi.fn()}
					isCompact={false}
				/>
			)
		).not.toThrow();
	});

	it("AiLtxI2VSettings", async () => {
		const { AiLtxI2VSettings } = await import("../ai-ltx-i2v-settings");
		expect(() =>
			render(
				<AiLtxI2VSettings
					duration={6}
					onDurationChange={vi.fn()}
					resolution="1080p"
					onResolutionChange={vi.fn()}
					fps={25}
					onFpsChange={vi.fn()}
					generateAudio={false}
					onGenerateAudioChange={vi.fn()}
					isCompact={false}
				/>
			)
		).not.toThrow();
	});

	it("AiLtxFastI2VSettings", async () => {
		const { AiLtxFastI2VSettings } = await import(
			"../ai-ltx-fast-i2v-settings"
		);
		expect(() =>
			render(
				<AiLtxFastI2VSettings
					duration={6}
					onDurationChange={vi.fn()}
					resolution="1080p"
					onResolutionChange={vi.fn()}
					fps={25}
					onFpsChange={vi.fn()}
					generateAudio={false}
					onGenerateAudioChange={vi.fn()}
					isCompact={false}
				/>
			)
		).not.toThrow();
	});

	it("AiSeedanceSettings", async () => {
		const { AiSeedanceSettings } = await import("../ai-seedance-settings");
		expect(() =>
			render(
				<AiSeedanceSettings
					duration={5}
					onDurationChange={vi.fn()}
					resolution="720p"
					onResolutionChange={vi.fn()}
					aspectRatio="16:9"
					onAspectRatioChange={vi.fn()}
					cameraFixed={false}
					onCameraFixedChange={vi.fn()}
					endFrameUrl={undefined}
					onEndFrameUrlChange={vi.fn()}
					endFrameFile={null}
					endFramePreview={null}
					onEndFrameFileChange={vi.fn()}
					isProSelected={false}
					isCompact={false}
					onError={vi.fn()}
				/>
			)
		).not.toThrow();
	});

	it("AiKlingV25Settings", async () => {
		const { AiKlingV25Settings } = await import("../ai-kling-v25-settings");
		expect(() =>
			render(
				<AiKlingV25Settings
					duration={5}
					onDurationChange={vi.fn()}
					aspectRatio="16:9"
					onAspectRatioChange={vi.fn()}
					cfgScale={0.5}
					onCfgScaleChange={vi.fn()}
					enhancePrompt={false}
					onEnhancePromptChange={vi.fn()}
					negativePrompt=""
					onNegativePromptChange={vi.fn()}
					isCompact={false}
				/>
			)
		).not.toThrow();
	});

	it("AiKlingV26Settings", async () => {
		const { AiKlingV26Settings } = await import("../ai-kling-v26-settings");
		expect(() =>
			render(
				<AiKlingV26Settings
					duration={5}
					onDurationChange={vi.fn()}
					aspectRatio="16:9"
					onAspectRatioChange={vi.fn()}
					cfgScale={0.5}
					onCfgScaleChange={vi.fn()}
					generateAudio={false}
					onGenerateAudioChange={vi.fn()}
					negativePrompt=""
					onNegativePromptChange={vi.fn()}
					isCompact={false}
				/>
			)
		).not.toThrow();
	});

	it("AiWan25Settings", async () => {
		const { AiWan25Settings } = await import("../ai-wan25-settings");
		expect(() =>
			render(
				<AiWan25Settings
					duration={5}
					onDurationChange={vi.fn()}
					resolution="480p"
					onResolutionChange={vi.fn()}
					enablePromptExpansion={false}
					onEnablePromptExpansionChange={vi.fn()}
					negativePrompt=""
					onNegativePromptChange={vi.fn()}
					audioUrl={undefined}
					onAudioUrlChange={vi.fn()}
					audioFile={null}
					audioPreview={null}
					onAudioFileChange={vi.fn()}
					isCompact={false}
					onError={vi.fn()}
				/>
			)
		).not.toThrow();
	});
});
