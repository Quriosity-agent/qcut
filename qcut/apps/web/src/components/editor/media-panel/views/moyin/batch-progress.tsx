/**
 * BatchProgressOverlay — progress overlay for batch shot generation.
 * Manages its own batch state via a hook to avoid bloating moyin-store.
 */

import { useState, useRef, useCallback } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, XIcon, ImageIcon, VideoIcon } from "lucide-react";

type BatchType = "image" | "video";

interface BatchState {
	isRunning: boolean;
	type: BatchType;
	current: number;
	total: number;
	message: string;
}

/** Hook that drives batch generation using the store's per-shot actions. */
export function useBatchGeneration() {
	const [batch, setBatch] = useState<BatchState | null>(null);
	const abortRef = useRef(false);

	const generateShotImage = useMoyinStore((s) => s.generateShotImage);
	const generateShotVideo = useMoyinStore((s) => s.generateShotVideo);

	const startBatch = useCallback(
		async (type: BatchType) => {
			const shots = useMoyinStore.getState().shots;
			const pending =
				type === "image"
					? shots.filter((s) => s.imageStatus !== "completed")
					: shots.filter((s) => s.videoStatus !== "completed" && s.imageUrl);

			if (pending.length === 0) return;

			abortRef.current = false;
			setBatch({
				isRunning: true,
				type,
				current: 0,
				total: pending.length,
				message: `Starting batch ${type} generation...`,
			});

			for (let i = 0; i < pending.length; i++) {
				if (abortRef.current) break;

				setBatch((prev) =>
					prev
						? {
								...prev,
								current: i + 1,
								message: `Generating ${type} ${i + 1} of ${pending.length}...`,
							}
						: null
				);

				try {
					if (type === "image") {
						await generateShotImage(pending[i].id);
					} else {
						await generateShotVideo(pending[i].id);
					}
				} catch {
					// Per-shot errors are stored on the shot itself; continue batch
				}

				// Rate limit: 2s delay between requests
				if (i < pending.length - 1 && !abortRef.current) {
					await new Promise((r) => setTimeout(r, 2000));
				}
			}

			setBatch(null);
		},
		[generateShotImage, generateShotVideo]
	);

	const cancel = useCallback(() => {
		abortRef.current = true;
		setBatch(null);
	}, []);

	return { batch, startBatch, cancel };
}

/** Overlay shown during batch generation. */
export function BatchProgressOverlay({
	batch,
	onCancel,
}: {
	batch: BatchState;
	onCancel: () => void;
}) {
	const percent =
		batch.total > 0 ? Math.round((batch.current / batch.total) * 100) : 0;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div
				role="dialog"
				aria-label={`Batch ${batch.type === "image" ? "image" : "video"} generation`}
				className="w-[320px] rounded-lg border bg-background p-5 shadow-lg space-y-4"
			>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span className="text-sm font-medium">
							Batch {batch.type === "image" ? "Image" : "Video"} Generation
						</span>
					</div>
					<Button
						variant="text"
						size="sm"
						className="h-6 w-6 p-0"
						onClick={onCancel}
						aria-label="Close batch generation"
					>
						<XIcon className="h-3.5 w-3.5" />
					</Button>
				</div>

				<div className="space-y-2">
					<p className="text-xs text-muted-foreground">{batch.message}</p>
					<Progress value={percent} />
					<p className="text-[10px] text-muted-foreground text-right">
						{batch.current} / {batch.total} ({percent}%)
					</p>
				</div>

				<Button
					variant="outline"
					size="sm"
					className="w-full h-7 text-xs"
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/** Batch generation buttons for the Generate tab. */
export function BatchGenerateButtons({
	onStart,
	disabled,
}: {
	onStart: (type: BatchType) => void;
	disabled: boolean;
}) {
	const shots = useMoyinStore((s) => s.shots);
	const pendingImages = shots.filter(
		(s) => s.imageStatus !== "completed"
	).length;
	const pendingVideos = shots.filter(
		(s) => s.videoStatus !== "completed" && s.imageUrl
	).length;

	if (shots.length === 0) return null;

	return (
		<div className="space-y-1.5">
			<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
				Batch Generation
			</p>
			<div className="flex gap-1.5">
				<Button
					size="sm"
					variant="outline"
					className="flex-1 h-7 text-xs"
					onClick={() => onStart("image")}
					disabled={disabled || pendingImages === 0}
				>
					<ImageIcon className="mr-1 h-3 w-3" />
					Images ({pendingImages})
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="flex-1 h-7 text-xs"
					onClick={() => onStart("video")}
					disabled={disabled || pendingVideos === 0}
				>
					<VideoIcon className="mr-1 h-3 w-3" />
					Videos ({pendingVideos})
				</Button>
			</div>
		</div>
	);
}
