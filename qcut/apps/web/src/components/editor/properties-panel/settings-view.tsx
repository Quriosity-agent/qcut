"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	PropertyItem,
	PropertyItemLabel,
	PropertyItemValue,
	PropertyGroup,
} from "./property-item";
import { FPS_PRESETS } from "@/constants/timeline-constants";
import { useProjectStore } from "@/stores/project-store";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/debug/error-handler";
import { useEditorStore } from "@/stores/editor/editor-store";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";
// import Image from "next/image"; // Not needed in Vite
import { cn } from "@/lib/utils";
import { colors } from "@/data/colors";
import { PipetteIcon, KeyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useMemo, memo, useCallback, useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { BlurIntensity } from "@/types/project";

/** Top-level settings panel shown in the editor properties sidebar. */
export function SettingsView() {
	return <ProjectSettingsTabs />;
}

/** Tabbed settings panel with Project, Background, and API Keys sections. */
function ProjectSettingsTabs() {
	return (
		<div className="h-full flex flex-col">
			<Tabs defaultValue="project-info" className="flex flex-col h-full">
				<div className="px-3 pt-4 pb-0">
					<TabsList data-testid="settings-tabs">
						<TabsTrigger value="project-info" data-testid="project-info-tab">
							Project info
						</TabsTrigger>
						<TabsTrigger value="background" data-testid="background-tab">
							Background
						</TabsTrigger>
						<TabsTrigger value="api-keys" data-testid="api-keys-tab">
							API Keys
						</TabsTrigger>
					</TabsList>
				</div>
				<Separator className="my-4" />
				<ScrollArea className="flex-1">
					<TabsContent
						value="project-info"
						className="p-5 pt-0 mt-0"
						data-testid="project-info-content"
					>
						<ProjectInfoView />
					</TabsContent>
					<TabsContent
						value="background"
						className="p-4 pt-0"
						data-testid="background-content"
					>
						<BackgroundView />
					</TabsContent>
					<TabsContent
						value="api-keys"
						className="p-5 pt-0 mt-0"
						data-testid="api-keys-content"
					>
						<ApiKeysView />
					</TabsContent>
				</ScrollArea>
			</Tabs>
		</div>
	);
}

/** Displays project metadata (name, resolution, FPS) with editable controls. */
function ProjectInfoView() {
	const { activeProject, updateProjectFps } = useProjectStore();
	const { canvasSize, canvasPresets, setCanvasSize } = useEditorStore();
	const { getDisplayName, currentPreset } = useAspectRatio();

	const handleAspectRatioChange = useCallback(
		(value: string) => {
			const preset = canvasPresets.find((p) => p.name === value);
			if (preset) {
				setCanvasSize({ width: preset.width, height: preset.height });
			}
		},
		[canvasPresets, setCanvasSize]
	);

	const handleFpsChange = useCallback(
		(value: string) => {
			const fps = parseFloat(value);
			if (!isNaN(fps) && fps > 0) {
				updateProjectFps(fps);
			}
		},
		[updateProjectFps]
	);

	return (
		<div className="flex flex-col gap-4">
			<PropertyItem direction="column">
				<PropertyItemLabel>Name</PropertyItemLabel>
				<PropertyItemValue>
					{activeProject?.name || "Untitled project"}
				</PropertyItemValue>
			</PropertyItem>

			<PropertyItem direction="column">
				<PropertyItemLabel>Aspect ratio</PropertyItemLabel>
				<PropertyItemValue>
					<Select
						value={currentPreset?.name}
						onValueChange={handleAspectRatioChange}
					>
						<SelectTrigger className="bg-panel-accent">
							<SelectValue placeholder={getDisplayName()} />
						</SelectTrigger>
						<SelectContent>
							{canvasPresets.map((preset) => (
								<SelectItem key={preset.name} value={preset.name}>
									{preset.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</PropertyItemValue>
			</PropertyItem>

			<PropertyItem direction="column">
				<PropertyItemLabel>Frame rate</PropertyItemLabel>
				<PropertyItemValue>
					<Select
						value={(activeProject?.fps || 30).toString()}
						onValueChange={handleFpsChange}
					>
						<SelectTrigger className="bg-panel-accent">
							<SelectValue placeholder="Select a frame rate" />
						</SelectTrigger>
						<SelectContent>
							{FPS_PRESETS.map((preset) => (
								<SelectItem key={preset.value} value={preset.value}>
									{preset.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</PropertyItemValue>
			</PropertyItem>
		</div>
	);
}

/** Memoized preview of the blur background effect with a gradient sample. */
const BlurPreview = memo(
	({
		blur,
		isSelected,
		onSelect,
	}: {
		blur: { label: string; value: number };
		isSelected: boolean;
		onSelect: () => void;
	}) => (
		<button
			type="button"
			className={cn(
				"w-full aspect-square rounded-sm cursor-pointer hover:outline-2 hover:outline-primary relative overflow-hidden focus-visible:outline-2 focus-visible:outline-primary",
				isSelected && "outline-2 outline-primary"
			)}
			onClick={onSelect}
			aria-pressed={isSelected}
			aria-label={`Select ${blur.label.toLowerCase()} blur`}
		>
			<div
				className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-400 via-purple-500 to-pink-400"
				style={{ filter: `blur(${blur.value}px)` }}
			/>
			<div className="absolute bottom-1 left-1 right-1 text-center">
				<span className="text-xs text-foreground bg-background/50 px-1 rounded">
					{blur.label}
				</span>
			</div>
		</button>
	)
);

BlurPreview.displayName = "BlurPreview";

/** Background settings panel for choosing between solid color and blur background modes. */
function BackgroundView() {
	const { activeProject, updateBackgroundType } = useProjectStore();

	const blurLevels = useMemo(
		() => [
			{ label: "Light", value: 4 },
			{ label: "Medium", value: 8 },
			{ label: "Heavy", value: 18 },
		],
		[]
	);

	const handleBlurSelect = useCallback(
		async (blurIntensity: number) => {
			await updateBackgroundType("blur", {
				blurIntensity: blurIntensity as BlurIntensity,
			});
		},
		[updateBackgroundType]
	);

	const handleColorSelect = useCallback(
		async (color: string) => {
			await updateBackgroundType("color", { backgroundColor: color });
		},
		[updateBackgroundType]
	);

	const currentBlurIntensity = activeProject?.blurIntensity || 8;
	const isBlurBackground = activeProject?.backgroundType === "blur";
	const currentBackgroundColor = activeProject?.backgroundColor || "#000000";
	const isColorBackground = activeProject?.backgroundType === "color";

	const blurPreviews = useMemo(
		() =>
			blurLevels.map((blur) => (
				<BlurPreview
					key={blur.value}
					blur={blur}
					isSelected={isBlurBackground && currentBlurIntensity === blur.value}
					onSelect={() => handleBlurSelect(blur.value)}
				/>
			)),
		[blurLevels, isBlurBackground, currentBlurIntensity, handleBlurSelect]
	);

	const colorPreviews = useMemo(
		() =>
			colors.map((color) => (
				<button
					type="button"
					key={color}
					className={cn(
						"w-full aspect-square rounded-sm cursor-pointer hover:border-2 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
						isColorBackground &&
							color === currentBackgroundColor &&
							"border-2 border-primary"
					)}
					style={{ backgroundColor: color }}
					onClick={() => handleColorSelect(color)}
					aria-pressed={isColorBackground && color === currentBackgroundColor}
					aria-label={`Select color ${color}`}
					title={`Select color ${color}`}
				/>
			)),
		[isColorBackground, currentBackgroundColor, handleColorSelect]
	);

	return (
		<div className="flex flex-col gap-5">
			<PropertyGroup title="Blur">
				<div className="grid grid-cols-4 gap-2 w-full">{blurPreviews}</div>
			</PropertyGroup>

			<PropertyGroup title="Color">
				<div className="grid grid-cols-4 gap-2 w-full">
					<button
						type="button"
						className="w-full aspect-square rounded-sm cursor-pointer border border-foreground/15 hover:border-primary flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
						aria-label="Pick a custom color"
						title="Pick a custom color"
					>
						<PipetteIcon className="size-4" />
					</button>
					{colorPreviews}
				</div>
			</PropertyGroup>
		</div>
	);
}

/** Small badge showing the source of an API key (env, app, cli). */
function KeySourceBadge({ source }: { source: string }) {
	if (source === "not-set") return null;
	const labels: Record<string, string> = {
		environment: "env",
		electron: "app",
		"aicp-cli": "cli",
	};
	return (
		<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
			{labels[source] || source}
		</span>
	);
}

/** API key management panel with inputs for FAL, Freesound, Gemini, OpenRouter, and Anthropic keys. */
function ApiKeysView() {
	const [falApiKey, setFalApiKey] = useState("");
	const [freesoundApiKey, setFreesoundApiKey] = useState("");
	const [geminiApiKey, setGeminiApiKey] = useState("");
	const [openRouterApiKey, setOpenRouterApiKey] = useState("");
	const [anthropicApiKey, setAnthropicApiKey] = useState("");
	const [showFalKey, setShowFalKey] = useState(false);
	const [showFreesoundKey, setShowFreesoundKey] = useState(false);
	const [showGeminiKey, setShowGeminiKey] = useState(false);
	const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
	const [showAnthropicKey, setShowAnthropicKey] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [isTestingFreesound, setIsTestingFreesound] = useState(false);
	const [freesoundTestResult, setFreesoundTestResult] = useState<{
		success: boolean;
		message: string;
	} | null>(null);
	const [isTestingFal, setIsTestingFal] = useState(false);
	const [falTestResult, setFalTestResult] = useState<{
		success: boolean;
		message: string;
	} | null>(null);
	const [keyStatuses, setKeyStatuses] = useState<Record<
		string,
		{ set: boolean; source: string }
	> | null>(null);

	// Load API keys and statuses on component mount
	const loadApiKeys = useCallback(async () => {
		try {
			if (window.electronAPI?.apiKeys) {
				const keys = await window.electronAPI.apiKeys.get();
				if (keys) {
					setFalApiKey(keys.falApiKey || "");
					setFreesoundApiKey(keys.freesoundApiKey || "");
					setGeminiApiKey(keys.geminiApiKey || "");
					setOpenRouterApiKey(keys.openRouterApiKey || "");
					setAnthropicApiKey(keys.anthropicApiKey || "");
				}
				if (window.electronAPI.apiKeys.status) {
					const statuses = await window.electronAPI.apiKeys.status();
					setKeyStatuses(statuses);
				}
			}
		} catch (error) {
			handleError(error, {
				operation: "Load API Keys",
				category: ErrorCategory.STORAGE,
				severity: ErrorSeverity.LOW,
				showToast: false,
				metadata: {
					operation: "load-api-keys",
				},
			});
		} finally {
			setIsLoading(false);
		}
	}, []);

	// Save API keys
	const saveApiKeys = useCallback(async () => {
		try {
			if (!window.electronAPI?.apiKeys) {
				console.error("[Settings] ❌ window.electronAPI.apiKeys not available");
				throw new Error("Electron API not available");
			}

			console.log("[Settings] 📤 Calling window.electronAPI.apiKeys.set()...");

			const result = await window.electronAPI.apiKeys.set({
				falApiKey: falApiKey.trim(),
				freesoundApiKey: freesoundApiKey.trim(),
				geminiApiKey: geminiApiKey.trim(),
				openRouterApiKey: openRouterApiKey.trim(),
				anthropicApiKey: anthropicApiKey.trim(),
			});

			console.log("[Settings] ✅ API keys saved successfully, result:", result);

			// Clear test results and refresh statuses after saving
			setFreesoundTestResult(null);
			setFalTestResult(null);
			if (window.electronAPI?.apiKeys?.status) {
				const statuses = await window.electronAPI.apiKeys.status();
				setKeyStatuses(statuses);
			}
		} catch (error) {
			console.error("[Settings] ❌ Error saving API keys:", error);
			handleError(error, {
				operation: "Save API Keys",
				category: ErrorCategory.STORAGE,
				severity: ErrorSeverity.MEDIUM,
				metadata: {
					operation: "save-api-keys",
				},
			});
		}
	}, [
		falApiKey,
		freesoundApiKey,
		geminiApiKey,
		openRouterApiKey,
		anthropicApiKey,
	]);

	// Test Freesound API key
	const testFreesoundKey = useCallback(async () => {
		setIsTestingFreesound(true);
		setFreesoundTestResult(null);
		try {
			if (window.electronAPI?.sounds) {
				const result = await window.electronAPI.sounds.search({
					q: "test",
				});
				setFreesoundTestResult({
					success: result.success,
					message: result.message || "Test completed",
				});
			}
		} catch (error) {
			setFreesoundTestResult({ success: false, message: "Test failed" });
		} finally {
			setIsTestingFreesound(false);
		}
	}, []);

	// Load keys on mount
	useEffect(() => {
		loadApiKeys();
	}, [loadApiKeys]);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-4">
				<div className="text-sm text-muted-foreground">Loading API keys...</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="text-sm text-muted-foreground">
				Configure API keys for enhanced features like AI image generation and
				sound effects.
			</div>

			{/* FAL API Key */}
			<PropertyGroup
				title={
					<span className="flex items-center gap-2">
						FAL AI API Key
						{keyStatuses?.falApiKey && (
							<KeySourceBadge source={keyStatuses.falApiKey.source} />
						)}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					<div className="text-xs text-muted-foreground">
						For AI image generation. Get your key at{" "}
						<span className="font-mono">fal.ai</span>
					</div>
					<div className="flex gap-2">
						<div className="flex-1 relative">
							<Input
								type={showFalKey ? "text" : "password"}
								placeholder="Enter your FAL API key"
								value={falApiKey}
								onChange={(e) => setFalApiKey(e.target.value)}
								className="bg-panel-accent pr-10"
								data-testid="fal-api-key-input"
							/>
							<Button
								type="button"
								variant="text"
								size="sm"
								className="absolute right-0 top-0 h-full px-3"
								onClick={() => setShowFalKey(!showFalKey)}
							>
								{showFalKey ? (
									<EyeOffIcon className="h-4 w-4" />
								) : (
									<EyeIcon className="h-4 w-4" />
								)}
							</Button>
						</div>
					</div>
				</div>
			</PropertyGroup>

			{/* Freesound API Key */}
			<PropertyGroup
				title={
					<span className="flex items-center gap-2">
						Freesound API Key
						{keyStatuses?.freesoundApiKey && (
							<KeySourceBadge source={keyStatuses.freesoundApiKey.source} />
						)}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					<div className="text-xs text-muted-foreground">
						For sound effects library. Get your key at{" "}
						<span className="font-mono">freesound.org/help/developers</span>
					</div>
					<div className="flex gap-2">
						<div className="flex-1 relative">
							<Input
								type={showFreesoundKey ? "text" : "password"}
								placeholder="Enter your Freesound API key"
								value={freesoundApiKey}
								onChange={(e) => {
									setFreesoundApiKey(e.target.value);
									setFreesoundTestResult(null); // Clear test result on change
								}}
								className="bg-panel-accent pr-10"
								data-testid="freesound-api-key-input"
							/>
							<Button
								type="button"
								variant="text"
								size="sm"
								className="absolute right-0 top-0 h-full px-3"
								onClick={() => setShowFreesoundKey(!showFreesoundKey)}
							>
								{showFreesoundKey ? (
									<EyeOffIcon className="h-4 w-4" />
								) : (
									<EyeIcon className="h-4 w-4" />
								)}
							</Button>
						</div>
						<Button
							onClick={testFreesoundKey}
							disabled={!freesoundApiKey || isTestingFreesound}
							variant="outline"
							size="sm"
						>
							{isTestingFreesound ? "Testing..." : "Test"}
						</Button>
					</div>
					{freesoundTestResult && (
						<div
							className={`text-xs ${freesoundTestResult.success ? "text-green-600" : "text-red-600"}`}
						>
							{freesoundTestResult.message}
						</div>
					)}
				</div>
			</PropertyGroup>

			{/* Gemini API Key */}
			<PropertyGroup
				title={
					<span className="flex items-center gap-2">
						Gemini API Key
						{keyStatuses?.geminiApiKey && (
							<KeySourceBadge source={keyStatuses.geminiApiKey.source} />
						)}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					<div className="text-xs text-muted-foreground">
						For AI caption transcription. Get your key at{" "}
						<a
							href="https://aistudio.google.com/app/apikey"
							target="_blank"
							rel="noopener noreferrer"
							className="font-mono text-primary hover:underline"
						>
							aistudio.google.com/app/apikey
						</a>
					</div>
					<div className="flex-1 relative">
						<Input
							type={showGeminiKey ? "text" : "password"}
							placeholder="Enter your Gemini API key (AIza...)"
							value={geminiApiKey}
							onChange={(e) => setGeminiApiKey(e.target.value)}
							className="bg-panel-accent pr-10"
							data-testid="gemini-api-key-input"
						/>
						<Button
							type="button"
							variant="text"
							size="sm"
							className="absolute right-0 top-0 h-full px-3"
							onClick={() => setShowGeminiKey(!showGeminiKey)}
						>
							{showGeminiKey ? (
								<EyeOffIcon className="h-4 w-4" />
							) : (
								<EyeIcon className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>
			</PropertyGroup>

			{/* OpenRouter API Key */}
			<PropertyGroup
				title={
					<span className="flex items-center gap-2">
						OpenRouter API Key
						{keyStatuses?.openRouterApiKey && (
							<KeySourceBadge source={keyStatuses.openRouterApiKey.source} />
						)}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					<div className="text-xs text-muted-foreground">
						For Codex CLI (300+ AI models). Get your key at{" "}
						<a
							href="https://openrouter.ai/keys"
							target="_blank"
							rel="noopener noreferrer"
							className="font-mono text-primary hover:underline"
						>
							openrouter.ai/keys
						</a>
					</div>
					<div className="flex-1 relative">
						<Input
							type={showOpenRouterKey ? "text" : "password"}
							placeholder="Enter your OpenRouter API key (sk-or-v1-...)"
							value={openRouterApiKey}
							onChange={(e) => setOpenRouterApiKey(e.target.value)}
							className="bg-panel-accent pr-10"
							data-testid="openrouter-api-key-input"
						/>
						<Button
							type="button"
							variant="text"
							size="sm"
							className="absolute right-0 top-0 h-full px-3"
							onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
						>
							{showOpenRouterKey ? (
								<EyeOffIcon className="h-4 w-4" />
							) : (
								<EyeIcon className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>
			</PropertyGroup>

			{/* Anthropic API Key (Optional) */}
			<PropertyGroup
				title={
					<span className="flex items-center gap-2">
						Anthropic API Key (Optional)
						{keyStatuses?.anthropicApiKey && (
							<KeySourceBadge source={keyStatuses.anthropicApiKey.source} />
						)}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					<div className="text-xs text-muted-foreground">
						Claude Code uses your Claude Pro/Max subscription by default. Only
						set this if you prefer API credits instead.
					</div>
					<div className="flex-1 relative">
						<Input
							type={showAnthropicKey ? "text" : "password"}
							placeholder="Optional: sk-ant-..."
							value={anthropicApiKey}
							onChange={(e) => setAnthropicApiKey(e.target.value)}
							className="bg-panel-accent pr-10"
							data-testid="anthropic-api-key-input"
						/>
						<Button
							type="button"
							variant="text"
							size="sm"
							className="absolute right-0 top-0 h-full px-3"
							onClick={() => setShowAnthropicKey(!showAnthropicKey)}
							aria-label={
								showAnthropicKey
									? "Hide Anthropic API key"
									: "Show Anthropic API key"
							}
						>
							{showAnthropicKey ? (
								<EyeOffIcon className="h-4 w-4" aria-hidden="true" />
							) : (
								<EyeIcon className="h-4 w-4" aria-hidden="true" />
							)}
						</Button>
					</div>
					<div className="text-xs text-muted-foreground">
						Requires <span className="font-mono">claude</span> CLI installed.{" "}
						<a
							href="https://claude.ai/download"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline"
						>
							Download Claude Code
						</a>
					</div>
				</div>
			</PropertyGroup>

			{/* Save Button */}
			<div className="flex justify-end">
				<Button
					type="button"
					onClick={saveApiKeys}
					className="gap-2"
					data-testid="save-api-keys-button"
				>
					<KeyIcon className="h-4 w-4" aria-hidden="true" />
					Save API Keys
				</Button>
			</div>

			<div className="text-xs text-muted-foreground border-t pt-4">
				<strong>Note:</strong> API keys are stored securely on your device and
				never shared. Restart the application after saving for changes to take
				effect.
			</div>
		</div>
	);
}
