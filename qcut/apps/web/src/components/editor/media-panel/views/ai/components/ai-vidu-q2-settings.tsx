import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface AiViduQ2SettingsProps {
	duration: 2 | 3 | 4 | 5 | 6 | 7 | 8;
	onDurationChange: (value: 2 | 3 | 4 | 5 | 6 | 7 | 8) => void;
	resolution: "720p" | "1080p";
	onResolutionChange: (value: "720p" | "1080p") => void;
	movementAmplitude: "auto" | "small" | "medium" | "large";
	onMovementAmplitudeChange: (
		value: "auto" | "small" | "medium" | "large"
	) => void;
	bgm: boolean;
	onBgmChange: (value: boolean) => void;
	isCompact: boolean;
}

export function AiViduQ2Settings({
	duration,
	onDurationChange,
	resolution,
	onResolutionChange,
	movementAmplitude,
	onMovementAmplitudeChange,
	bgm,
	onBgmChange,
	isCompact: _isCompact,
}: AiViduQ2SettingsProps) {
	return (
		<div className="space-y-3 text-left border-t pt-3">
			<Label className="text-sm font-semibold">Vidu Q2 Turbo Settings</Label>

			<div className="space-y-1">
				<Label htmlFor="vidu-duration" className="text-xs">
					Duration
				</Label>
				<Select
					value={duration.toString()}
					onValueChange={(value) =>
						onDurationChange(Number(value) as 2 | 3 | 4 | 5 | 6 | 7 | 8)
					}
				>
					<SelectTrigger id="vidu-duration" className="h-8 text-xs">
						<SelectValue placeholder="Select duration" />
					</SelectTrigger>
					<SelectContent>
						{[2, 3, 4, 5, 6, 7, 8].map((durationOption) => (
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
				<Label htmlFor="vidu-resolution" className="text-xs">
					Resolution
				</Label>
				<Select
					value={resolution}
					onValueChange={(value) =>
						onResolutionChange(value as "720p" | "1080p")
					}
				>
					<SelectTrigger id="vidu-resolution" className="h-8 text-xs">
						<SelectValue placeholder="Select resolution" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="720p">720p ($0.05/sec)</SelectItem>
						<SelectItem value="1080p">
							1080p ($0.20 base + $0.05/sec)
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-1">
				<Label htmlFor="vidu-movement" className="text-xs">
					Movement Amplitude
				</Label>
				<Select
					value={movementAmplitude}
					onValueChange={(value) =>
						onMovementAmplitudeChange(
							value as "auto" | "small" | "medium" | "large"
						)
					}
				>
					<SelectTrigger id="vidu-movement" className="h-8 text-xs">
						<SelectValue placeholder="Select motion" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">Auto</SelectItem>
						<SelectItem value="small">Small</SelectItem>
						<SelectItem value="medium">Medium</SelectItem>
						<SelectItem value="large">Large</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{duration === 4 && (
				<div className="flex items-center space-x-2">
					<Checkbox
						id="vidu-bgm"
						checked={bgm}
						onCheckedChange={(checked) => onBgmChange(Boolean(checked))}
					/>
					<Label htmlFor="vidu-bgm" className="text-xs">
						Add background music (4-second videos only)
					</Label>
				</div>
			)}

			<div className="text-xs text-muted-foreground">
				Pricing: 720p @ $0.05/sec • 1080p adds $0.20 base fee
			</div>
		</div>
	);
}
