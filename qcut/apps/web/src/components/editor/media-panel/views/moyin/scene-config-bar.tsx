/**
 * SceneConfigBar — Project-level generation settings bar.
 * Matches the moyin-creator top config: aspect ratio, resolution, gen mode, quality prompt.
 */

import {
	useMoyinGenConfig,
	type AspectRatio,
	type Resolution,
	type GenMode,
} from "@/stores/moyin/moyin-gen-config";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";

// ── Toggle button helper ─────────────────────────────────────────

function ToggleButton({
	active,
	onClick,
	children,
	className,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors",
				active
					? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
					: "bg-muted/40 text-muted-foreground hover:bg-muted/60 border border-transparent",
				className
			)}
		>
			{children}
		</button>
	);
}

// ── Dropdown pill helper ─────────────────────────────────────────

function DropdownPill({
	value,
	options,
	onChange,
	color = "green",
}: {
	value: string;
	options: { value: string; label: string }[];
	onChange: (v: string) => void;
	color?: "green" | "blue" | "orange";
}) {
	const colors = {
		green: "bg-green-500/15 text-green-400 border-green-500/30",
		blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
		orange: "bg-orange-500/15 text-orange-400 border-orange-500/30",
	};
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className={cn(
				"appearance-none px-2 py-1 rounded text-[10px] font-medium border cursor-pointer",
				"bg-transparent focus:outline-none focus:ring-1 focus:ring-purple-500/50",
				colors[color]
			)}
		>
			{options.map((opt) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	);
}

// ── Resolution options ───────────────────────────────────────────

const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
	{ value: "480p", label: "Standard (480P)" },
	{ value: "720p", label: "HD (720P)" },
	{ value: "1080p", label: "Full HD (1080P)" },
	{ value: "2k", label: "2K" },
];

// ── Main component ───────────────────────────────────────────────

export function SceneConfigBar() {
	const aspectRatio = useMoyinGenConfig((s) => s.aspectRatio);
	const resolution = useMoyinGenConfig((s) => s.resolution);
	const genMode = useMoyinGenConfig((s) => s.genMode);
	const qualityPrompt = useMoyinGenConfig((s) => s.qualityPrompt);

	const setAspectRatio = useMoyinGenConfig((s) => s.setAspectRatio);
	const setResolution = useMoyinGenConfig((s) => s.setResolution);
	const setGenMode = useMoyinGenConfig((s) => s.setGenMode);
	const setQualityPrompt = useMoyinGenConfig((s) => s.setQualityPrompt);

	return (
		<div className="space-y-2 border-b pb-2 mb-2">
			{/* Row 1: Aspect ratio + Resolution */}
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider shrink-0">
					Ratio
				</span>
				<div className="flex items-center gap-0.5">
					<ToggleButton
						active={aspectRatio === "landscape"}
						onClick={() => setAspectRatio("landscape")}
					>
						<MonitorIcon className="h-3 w-3" />
						Landscape
					</ToggleButton>
					<ToggleButton
						active={aspectRatio === "portrait"}
						onClick={() => setAspectRatio("portrait")}
					>
						<SmartphoneIcon className="h-3 w-3" />
						Portrait
					</ToggleButton>
				</div>

				<DropdownPill
					value={resolution}
					options={RESOLUTION_OPTIONS}
					onChange={(v) => setResolution(v as Resolution)}
					color="blue"
				/>
			</div>

			{/* Row 2: Gen mode + Quality prompt */}
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider shrink-0">
					Mode
				</span>
				<div className="flex items-center gap-0.5">
					<ToggleButton
						active={genMode === "single"}
						onClick={() => setGenMode("single")}
					>
						Single
					</ToggleButton>
					<ToggleButton
						active={genMode === "merged"}
						onClick={() => setGenMode("merged")}
					>
						Merged
					</ToggleButton>
				</div>

				<Input
					className="h-6 text-[10px] flex-1 min-w-[120px]"
					value={qualityPrompt}
					onChange={(e) => setQualityPrompt(e.target.value)}
					placeholder="best quality, masterpiece..."
					title="Quality prompt prefix appended to all generation prompts"
				/>
			</div>
		</div>
	);
}
