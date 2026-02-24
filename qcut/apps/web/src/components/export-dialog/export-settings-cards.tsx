import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformIcon } from "@/components/export-icons";
import { cn } from "@/lib/utils";
import {
	ExportQuality,
	ExportFormat,
	QUALITY_RESOLUTIONS,
	FORMAT_INFO,
	EXPORT_PRESETS,
	type ExportPreset,
} from "@/types/export";

// ---------------------------------------------------------------------------
// Prop interfaces
// ---------------------------------------------------------------------------

export interface PresetGridProps {
	selectedPreset: ExportPreset | null;
	onPresetSelect: (preset: ExportPreset) => void;
	onClearPreset: () => void;
	isExporting: boolean;
}

export interface FilenameCardProps {
	filename: string;
	onFilenameChange: (value: string) => void;
	hasValidFilename: boolean;
	isExporting: boolean;
}

export interface QualityCardProps {
	quality: ExportQuality;
	estimatedSize: string;
	onQualityChange: (quality: ExportQuality) => void;
	isExporting: boolean;
}

export interface EngineCardProps {
	engineType: "standard" | "ffmpeg" | "cli";
	ffmpegAvailable: boolean;
	isElectron: boolean;
	onEngineTypeChange: (type: "standard" | "ffmpeg" | "cli") => void;
	isExporting: boolean;
}

export interface FormatCardProps {
	format: ExportFormat;
	supportedFormats: ExportFormat[];
	onFormatChange: (format: ExportFormat) => void;
	isExporting: boolean;
}

export interface DetailsCardProps {
	resolution: { label: string } | undefined;
	estimatedSize: string;
	timelineDuration: number;
	format: ExportFormat;
	engineRecommendation: string | null;
}

// ---------------------------------------------------------------------------
// PresetGrid
// ---------------------------------------------------------------------------

export function PresetGrid({
	selectedPreset,
	onPresetSelect,
	onClearPreset,
	isExporting,
}: PresetGridProps) {
	return (
		<>
			<div className="grid grid-cols-2 gap-2 mb-4">
				{EXPORT_PRESETS.map((preset) => (
					<Button
						key={preset.name}
						variant={
							selectedPreset?.name === preset.name ? "default" : "outline"
						}
						size="sm"
						onClick={() => onPresetSelect(preset)}
						className="text-xs p-3 h-auto overflow-hidden"
						disabled={isExporting}
					>
						<div className="flex flex-col items-center gap-1.5 w-full">
							<PlatformIcon presetId={preset.id} className="size-5 shrink-0" />
							<div className="flex flex-col items-center gap-0.5 w-full">
								<span className="font-medium text-xs">{preset.name}</span>
								<span className="text-[0.6rem] opacity-70 leading-tight text-center line-clamp-2">
									{preset.description}
								</span>
							</div>
						</div>
					</Button>
				))}
			</div>

			{selectedPreset && (
				<div className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
					<span className="text-sm">
						Using <span className="font-medium">{selectedPreset.name}</span>{" "}
						preset
					</span>
					<Button
						variant="text"
						size="sm"
						onClick={onClearPreset}
						className="h-6 px-2 text-xs"
					>
						Clear
					</Button>
				</div>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// FilenameCard
// ---------------------------------------------------------------------------

export function FilenameCard({
	filename,
	onFilenameChange,
	hasValidFilename,
	isExporting,
}: FilenameCardProps) {
	return (
		<Card className="col-span-2">
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">File Name</CardTitle>
			</CardHeader>
			<CardContent>
				<Input
					type="text"
					value={filename}
					onChange={(e) => onFilenameChange(e.target.value)}
					placeholder="Enter filename"
					disabled={isExporting}
					className="text-sm"
					data-testid="export-filename-input"
				/>
				{!hasValidFilename && filename && (
					<p className="text-xs text-red-500 mt-1">
						Invalid filename. Use only letters, numbers, hyphens, and
						underscores.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// QualityCard
// ---------------------------------------------------------------------------

export function QualityCard({
	quality,
	estimatedSize,
	onQualityChange,
	isExporting,
}: QualityCardProps) {
	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">Quality</CardTitle>
			</CardHeader>
			<CardContent>
				<RadioGroup
					value={quality}
					onValueChange={(value) => onQualityChange(value as ExportQuality)}
					disabled={isExporting}
					data-testid="export-quality-select"
				>
					{Object.values(ExportQuality).map((q) => {
						const resolution = QUALITY_RESOLUTIONS[q];
						if (!resolution) return null;
						return (
							<div key={q} className="flex items-center space-x-2">
								<RadioGroupItem value={q} id={q} />
								<Label htmlFor={q} className="text-sm cursor-pointer">
									<div>
										<div className="font-medium">{resolution.label}</div>
										<div className="text-xs text-muted-foreground">
											~{estimatedSize}
										</div>
									</div>
								</Label>
							</div>
						);
					})}
				</RadioGroup>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// EngineCard
// ---------------------------------------------------------------------------

export function EngineCard({
	engineType,
	ffmpegAvailable,
	isElectron,
	onEngineTypeChange,
	isExporting,
}: EngineCardProps) {
	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">Export Engine</CardTitle>
			</CardHeader>
			<CardContent>
				<RadioGroup
					value={engineType}
					onValueChange={(value) =>
						onEngineTypeChange(value as "standard" | "ffmpeg" | "cli")
					}
					disabled={isExporting}
				>
					<div className="flex items-start space-x-2">
						<RadioGroupItem value="standard" id="standard" className="mt-0.5" />
						<Label
							htmlFor="standard"
							className="text-sm cursor-pointer flex-1 min-w-0"
						>
							<div className="flex items-center gap-1 flex-wrap">
								<span className="flex-shrink-0">📹</span>
								<span>Standard</span>
							</div>
						</Label>
					</div>
					{ffmpegAvailable && (
						<div className="flex items-start space-x-2">
							<RadioGroupItem value="ffmpeg" id="ffmpeg" className="mt-0.5" />
							<Label
								htmlFor="ffmpeg"
								className="text-sm cursor-pointer flex-1 min-w-0"
							>
								<div className="flex items-center gap-1 flex-wrap">
									<span className="flex-shrink-0">🚀</span>
									<span>FFmpeg WASM</span>
									<span className="text-xs text-muted-foreground">
										(5x faster)
									</span>
								</div>
							</Label>
						</div>
					)}
					{isElectron && (
						<div className="flex items-start space-x-2">
							<RadioGroupItem value="cli" id="cli" className="mt-0.5" />
							<Label
								htmlFor="cli"
								className="text-sm cursor-pointer flex-1 min-w-0"
							>
								<div className="flex items-center gap-1 flex-wrap">
									<span className="flex-shrink-0">⚡</span>
									<span>Native CLI</span>
									<span className="text-xs text-muted-foreground">
										(10x faster)
									</span>
								</div>
							</Label>
						</div>
					)}
				</RadioGroup>
				<p className="text-xs text-muted-foreground mt-2 break-words">
					{engineType === "cli"
						? "Native FFmpeg CLI provides maximum performance with hardware acceleration"
						: engineType === "ffmpeg"
							? "FFmpeg WASM provides 5x faster encoding than standard MediaRecorder"
							: "Standard MediaRecorder (compatible with all browsers)"}
				</p>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// FormatCard
// ---------------------------------------------------------------------------

export function FormatCard({
	format,
	supportedFormats,
	onFormatChange,
	isExporting,
}: FormatCardProps) {
	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">Format</CardTitle>
			</CardHeader>
			<CardContent>
				<RadioGroup
					value={format}
					onValueChange={(value) => onFormatChange(value as ExportFormat)}
					disabled={isExporting}
					data-testid="export-format-select"
				>
					{supportedFormats.map((fmt) => (
						<div key={fmt} className="flex items-center space-x-2">
							<RadioGroupItem value={fmt} id={fmt} />
							<Label htmlFor={fmt} className="text-sm cursor-pointer">
								<div>
									<div className="font-medium">{FORMAT_INFO[fmt].label}</div>
									<div className="text-xs text-muted-foreground">
										{FORMAT_INFO[fmt].description}
									</div>
								</div>
							</Label>
						</div>
					))}
				</RadioGroup>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// DetailsCard
// ---------------------------------------------------------------------------

export function DetailsCard({
	resolution,
	estimatedSize,
	timelineDuration,
	format,
	engineRecommendation,
}: DetailsCardProps) {
	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">Export Details</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="space-y-2 text-sm">
					<div className="flex justify-between items-center gap-2">
						<span className="font-medium flex-shrink-0">Resolution:</span>
						<span className="text-muted-foreground text-right truncate">
							{resolution?.label || "N/A"}
						</span>
					</div>
					<div className="flex justify-between items-center gap-2">
						<span className="font-medium flex-shrink-0">Est. size:</span>
						<span className="text-muted-foreground text-right truncate">
							{estimatedSize}
						</span>
					</div>
					<div className="flex justify-between items-center gap-2">
						<span className="font-medium flex-shrink-0">Duration:</span>
						<span
							className={cn(
								"text-right truncate",
								timelineDuration === 0
									? "text-red-500"
									: "text-muted-foreground"
							)}
						>
							{timelineDuration === 0
								? "No content"
								: `${timelineDuration.toFixed(2)}s`}
						</span>
					</div>
					<div className="flex justify-between items-center gap-2">
						<span className="font-medium flex-shrink-0">Format:</span>
						<span className="text-muted-foreground text-right truncate">
							{FORMAT_INFO[format].label}
						</span>
					</div>
					{engineRecommendation && (
						<div className="flex justify-between items-center gap-2">
							<span className="font-medium flex-shrink-0">Engine:</span>
							<span className="text-muted-foreground text-right truncate">
								{engineRecommendation}
							</span>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
