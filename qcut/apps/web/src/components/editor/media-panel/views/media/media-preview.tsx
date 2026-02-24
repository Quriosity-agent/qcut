import type { MediaItem } from "@/stores/media/media-store-types";
import { Image, Loader2, Music, Video } from "lucide-react";

/** Format seconds as mm:ss */
function formatDuration(duration: number) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

interface MediaPreviewProps {
	item: MediaItem;
}

/** Renders a preview thumbnail for a single media item based on its type. */
export function MediaPreview({ item }: MediaPreviewProps) {
	if (item.type === "image") {
		const imageUrl = item.url || item.thumbnailUrl;

		return (
			<div className="w-full h-full flex items-center justify-center">
				<img
					src={imageUrl}
					alt={item.name}
					className="max-w-full max-h-full object-contain"
					loading="lazy"
				/>
			</div>
		);
	}

	if (item.type === "video") {
		// Show loading spinner while thumbnail is being generated
		if (
			item.thumbnailStatus === "loading" ||
			item.thumbnailStatus === "pending"
		) {
			return (
				<div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
					<Loader2 className="h-6 w-6 mb-1 animate-spin" />
					<span className="text-xs">Loading...</span>
					{item.duration && (
						<span className="text-xs opacity-70">
							{formatDuration(item.duration)}
						</span>
					)}
				</div>
			);
		}

		// Show thumbnail if available
		if (item.thumbnailUrl) {
			return (
				<div className="relative w-full h-full">
					<img
						src={item.thumbnailUrl}
						alt={item.name}
						className="w-full h-full object-cover rounded"
						loading="lazy"
					/>
					<div className="absolute inset-0 flex items-center justify-center bg-background/20 rounded">
						<Video className="h-6 w-6 text-foreground drop-shadow-md" />
					</div>
					{item.duration && (
						<div className="absolute bottom-1 right-1 bg-background/70 text-foreground text-xs px-1 rounded">
							{formatDuration(item.duration)}
						</div>
					)}
				</div>
			);
		}

		// Fallback: no thumbnail available
		return (
			<div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
				<Video className="h-6 w-6 mb-1" />
				<span className="text-xs">Video</span>
				{item.duration && (
					<span className="text-xs opacity-70">
						{formatDuration(item.duration)}
					</span>
				)}
			</div>
		);
	}

	if (item.type === "audio") {
		return (
			<div className="w-full h-full bg-linear-to-br from-green-500/20 to-emerald-500/20 flex flex-col items-center justify-center text-muted-foreground rounded border border-green-500/20">
				<Music className="h-6 w-6 mb-1" />
				<span className="text-xs">Audio</span>
				{item.duration && (
					<span className="text-xs opacity-70">
						{formatDuration(item.duration)}
					</span>
				)}
			</div>
		);
	}

	return (
		<div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
			<Image className="h-6 w-6" />
			<span className="text-xs mt-1">Unknown</span>
		</div>
	);
}
