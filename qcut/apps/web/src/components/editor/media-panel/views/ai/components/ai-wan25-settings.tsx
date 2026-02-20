import { Checkbox } from "@/components/ui/checkbox";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AI_MODELS, UPLOAD_CONSTANTS } from "../constants/ai-constants";
import {
	WAN25_DURATIONS,
	WAN25_RESOLUTIONS,
	type Wan25Duration,
	type Wan25Resolution,
} from "../constants/ai-model-options";

export interface AiWan25SettingsProps {
	duration: Wan25Duration;
	onDurationChange: (value: Wan25Duration) => void;
	resolution: Wan25Resolution;
	onResolutionChange: (value: Wan25Resolution) => void;
	enablePromptExpansion: boolean;
	onEnablePromptExpansionChange: (value: boolean) => void;
	negativePrompt: string;
	onNegativePromptChange: (value: string) => void;
	audioUrl: string | undefined;
	onAudioUrlChange: (value: string | undefined) => void;
	audioFile: File | null;
	audioPreview: string | null;
	onAudioFileChange: (file: File | null, preview: string | null) => void;
	isCompact: boolean;
	onError: (error: string | null) => void;
}

export function AiWan25Settings({
	duration,
	onDurationChange,
	resolution,
	onResolutionChange,
	enablePromptExpansion,
	onEnablePromptExpansionChange,
	negativePrompt,
	onNegativePromptChange,
	audioUrl,
	onAudioUrlChange,
	audioFile,
	audioPreview,
	onAudioFileChange,
	isCompact,
	onError,
}: AiWan25SettingsProps) {
	const wan25ModelConfig = AI_MODELS.find(
		(model) => model.id === "wan_25_preview_i2v"
	);
	const durationOptions =
		wan25ModelConfig?.supportedDurations ?? WAN25_DURATIONS;
	const resolutionOptions =
		wan25ModelConfig?.supportedResolutions ?? WAN25_RESOLUTIONS;
	const pricePerSecond = wan25ModelConfig?.perSecondPricing?.[resolution] ?? 0;
	const estimatedCost = pricePerSecond * duration;

	const handleAudioFileChange = ({
		file,
		preview,
	}: {
		file: File | null;
		preview: string | null;
	}) => {
		try {
			onAudioFileChange(file, preview);
			if (file) {
				onAudioUrlChange(undefined);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to update audio";
			onError(message);
		}
	};

	return (
		<div className="space-y-3 text-left border-t pt-3">
			<Label className="text-sm font-semibold">WAN 2.5 Preview Settings</Label>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1">
					<Label htmlFor="wan25-duration" className="text-xs">
						Duration
					</Label>
					<Select
						value={duration.toString()}
						onValueChange={(value) =>
							onDurationChange(Number(value) as Wan25Duration)
						}
					>
						<SelectTrigger id="wan25-duration" className="h-8 text-xs">
							<SelectValue placeholder="Select duration" />
						</SelectTrigger>
						<SelectContent>
							{durationOptions.map((durationOption) => (
								<SelectItem
									key={durationOption}
									value={durationOption.toString()}
								>
									{durationOption} seconds
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label htmlFor="wan25-resolution" className="text-xs">
						Resolution
					</Label>
					<Select
						value={resolution}
						onValueChange={(value) =>
							onResolutionChange(value as Wan25Resolution)
						}
					>
						<SelectTrigger id="wan25-resolution" className="h-8 text-xs">
							<SelectValue placeholder="Select resolution" />
						</SelectTrigger>
						<SelectContent>
							{resolutionOptions.map((resolutionOption) => (
								<SelectItem key={resolutionOption} value={resolutionOption}>
									{resolutionOption.toUpperCase()} ( $
									{wan25ModelConfig?.perSecondPricing?.[resolutionOption] ?? 0}
									/sec)
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="flex items-center space-x-2">
				<Checkbox
					id="wan25-enhance-prompt"
					checked={enablePromptExpansion}
					onCheckedChange={(checked) =>
						onEnablePromptExpansionChange(Boolean(checked))
					}
				/>
				<Label htmlFor="wan25-enhance-prompt" className="text-xs">
					Enhance prompt with AI
				</Label>
			</div>

			<div className="space-y-1">
				<Label htmlFor="wan25-negative" className="text-xs">
					Negative Prompt (max 500 characters)
				</Label>
				<Textarea
					id="wan25-negative"
					value={negativePrompt}
					onChange={(event) =>
						onNegativePromptChange(event.target.value.slice(0, 500))
					}
					placeholder="Avoid blurry, shaky motion..."
					className="min-h-[60px] text-xs"
					maxLength={500}
				/>
				<div className="text-xs text-muted-foreground">
					{negativePrompt.length}/500 characters
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-xs font-medium">
					Background Music (optional)
				</Label>
				<Input
					type="url"
					value={audioUrl ?? ""}
					onChange={(event) =>
						onAudioUrlChange(event.target.value || undefined)
					}
					placeholder="https://example.com/music.mp3"
					className="h-8 text-xs"
				/>
				<FileUpload
					id="wan25-audio-upload"
					label="Upload Audio"
					helperText="MP3/WAV between 3-30 seconds (max 15MB)"
					fileType="audio"
					acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AUDIO_TYPES}
					maxSizeBytes={15 * 1024 * 1024}
					maxSizeLabel="15MB"
					formatsLabel={UPLOAD_CONSTANTS.AUDIO_FORMATS_LABEL}
					file={audioFile}
					preview={audioPreview}
					onFileChange={(file, preview) =>
						handleAudioFileChange({
							file,
							preview: preview || null,
						})
					}
					onError={(error) => onError(error)}
					isCompact={isCompact}
				/>
			</div>

			<div className="text-xs text-muted-foreground">
				Estimated cost: ${estimatedCost.toFixed(2)} ($
				{pricePerSecond.toFixed(2)}
				/sec)
			</div>
		</div>
	);
}
