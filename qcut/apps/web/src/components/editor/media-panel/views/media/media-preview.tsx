import type { MediaItem } from "@/stores/media/media-store-types";
import { useEffect, useState } from "react";
import { Image, Loader2, Music, Video } from "lucide-react";
import AudioWaveform from "@/components/editor/audio-waveform";

interface MediaPreviewProps {
	item: MediaItem;
}

function VideoPreview({ item }: MediaPreviewProps) {
	const previewUrl = item.thumbnailUrl;
	const [isLoading, setIsLoading] = useState(Boolean(item.thumbnailUrl));
	const [hasError, setHasError] = useState(false);
	const isGenerating =
		item.thumbnailStatus === "pending" || item.thumbnailStatus === "loading";

	useEffect(() => {
		setHasError(false);
		setIsLoading(Boolean(item.thumbnailUrl));
	}, [item.thumbnailUrl]);

	if (!previewUrl || hasError) {
		return (
			<div className="flex h-full w-full flex-col items-center justify-center bg-linear-to-br from-blue-500/20 to-cyan-500/20 text-muted-foreground">
				{isGenerating ? (
					<Loader2 className="mb-1 h-6 w-6 animate-spin" />
				) : (
					<Video className="mb-1 h-6 w-6" />
				)}
				<span className="text-xs">
					{isGenerating ? "Generating..." : "Video"}
				</span>
			</div>
		);
	}

	return (
		<div className="relative flex h-full w-full items-center justify-center overflow-hidden">
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-muted/20">
					<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
				</div>
			)}
			<img
				src={previewUrl}
				alt={item.name}
				className="h-full w-full object-cover"
				loading="lazy"
				onLoad={() => setIsLoading(false)}
				onError={() => {
					setHasError(true);
					setIsLoading(false);
				}}
			/>
		</div>
	);
}

/** Keyed by URL from MediaPreview, so a new picture starts without the error. */
function ImagePreview({ item }: MediaPreviewProps) {
	const imageUrl = item.url || item.thumbnailUrl;
	const [hasError, setHasError] = useState(false);

	if (!imageUrl || hasError) {
		return (
			<div className="flex h-full w-full flex-col items-center justify-center bg-muted/30 text-muted-foreground">
				<Image className="h-6 w-6" />
				<span className="mt-1 text-xs">Image</span>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full items-center justify-center overflow-hidden">
			<img
				src={imageUrl}
				alt={item.name}
				className="h-full w-full object-cover"
				loading="lazy"
				onError={() => setHasError(true)}
			/>
		</div>
	);
}

/**
 * Thumbnail for a media card. The card draws the duration and "added" badges
 * over it, so the preview only paints the picture (or a typed placeholder).
 */
export function MediaPreview({ item }: MediaPreviewProps) {
	if (item.type === "image") {
		return <ImagePreview key={item.url || item.thumbnailUrl} item={item} />;
	}

	if (item.type === "video") {
		return <VideoPreview item={item} />;
	}

	if (item.type === "audio") {
		return (
			<div className="relative h-full w-full overflow-hidden bg-[#1E3A5F]">
				<div className="absolute inset-x-1 inset-y-2">
					<AudioWaveform
						audioUrl={item.url || ""}
						sourcePath={item.localPath}
						sourceDuration={item.duration}
						cacheKey={
							item.file
								? `media:${item.id}:${item.file.size}:${item.file.lastModified}`
								: `media:${item.id}:${item.localPath ?? item.url ?? ""}`
						}
						className="h-full w-full"
						showStatus={false}
						barWidth={1}
						barGap={1}
						color="rgba(126, 196, 255, 0.95)"
						anchor="bottom"
					/>
				</div>
				<Music className="absolute bottom-1 left-1 h-3.5 w-3.5 text-[#7EC4FF]/80">
					<title>Audio</title>
				</Music>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col items-center justify-center bg-muted/30 text-muted-foreground">
			<Image className="h-6 w-6" />
			<span className="mt-1 text-xs">Unknown</span>
		</div>
	);
}
