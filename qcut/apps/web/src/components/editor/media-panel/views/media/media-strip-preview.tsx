import { type ReactNode, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Music, Video } from "lucide-react";
import AudioWaveform from "@/components/editor/audio-waveform";
import { useFilmstripThumbnails } from "@/hooks/timeline/use-filmstrip-thumbnails";
import type { MediaItem } from "@/stores/media/media-store-types";

/** Height of a list-view strip. The filmstrip hook pads eight pixels per tile. */
export const MEDIA_STRIP_HEIGHT = 56;

/** Tracks the strip's width and whether it is scrolled into view. */
function useStripGeometry() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [isVisible, setIsVisible] = useState(true);

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const measure = () => {
			const next = Math.floor(node.getBoundingClientRect().width);
			if (next > 0) setWidth(next);
		};
		measure();
		const resize =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		resize?.observe(node);
		const intersection =
			typeof IntersectionObserver === "undefined"
				? null
				: new IntersectionObserver(
						([entry]) => setIsVisible(entry.isIntersecting),
						{ threshold: 0 }
					);
		intersection?.observe(node);
		return () => {
			resize?.disconnect();
			intersection?.disconnect();
		};
	}, []);

	return { ref, width, isVisible };
}

function RepeatedImage({ url }: { url: string }) {
	return (
		<div
			className="h-full w-full"
			aria-hidden="true"
			style={{
				backgroundImage: `url(${url})`,
				backgroundRepeat: "repeat-x",
				backgroundSize: "auto 100%",
				backgroundPosition: "left center",
			}}
		/>
	);
}

function StripPlaceholder({ icon, label }: { icon: ReactNode; label: string }) {
	return (
		<div className="flex h-full w-full items-center justify-center gap-2 bg-muted/30 text-xs text-muted-foreground">
			{icon}
			<span>{label}</span>
		</div>
	);
}

function VideoStrip({
	item,
	width,
	isVisible,
}: {
	item: MediaItem;
	width: number;
	isVisible: boolean;
}) {
	const { frames } = useFilmstripThumbnails({
		mediaId: item.id,
		file: item.file,
		duration: item.duration ?? 0,
		trimStart: 0,
		trimEnd: 0,
		zoomLevel: 1,
		trackHeight: MEDIA_STRIP_HEIGHT + 8,
		clipWidthPx: width,
		enabled: item.thumbnailStatus === "ready" && isVisible && width > 0,
	});
	const isGenerating =
		item.thumbnailStatus === "pending" || item.thumbnailStatus === "loading";

	if (frames.length > 0) {
		return (
			<div
				className="flex h-full w-full"
				aria-hidden="true"
				data-testid="media-strip-frames"
			>
				{frames.map((frame, index) => {
					const url = frame.url ?? item.thumbnailUrl;
					return (
						<div
							key={`${frame.time}-${index}`}
							className="h-full min-w-0 flex-1 bg-cover bg-center"
							style={{
								backgroundImage: url ? `url(${url})` : undefined,
								borderRight:
									index < frames.length - 1
										? "1px solid rgba(255, 255, 255, 0.18)"
										: undefined,
							}}
						/>
					);
				})}
			</div>
		);
	}
	if (item.thumbnailUrl) {
		return <RepeatedImage url={item.thumbnailUrl} />;
	}
	return (
		<StripPlaceholder
			icon={
				isGenerating ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					<Video className="h-4 w-4" />
				)
			}
			label={isGenerating ? "Generating..." : "Video"}
		/>
	);
}

/**
 * Full-width preview for list view: a filmstrip for video, the picture
 * repeated for images, the waveform for audio. Video frames come from the
 * same cache the timeline uses, so a clip already on the timeline paints at
 * once, and extraction only runs for strips that are scrolled into view.
 */
export function MediaStripPreview({ item }: { item: MediaItem }) {
	const { ref, width, isVisible } = useStripGeometry();

	let content: ReactNode;
	if (item.type === "video") {
		content = <VideoStrip item={item} width={width} isVisible={isVisible} />;
	} else if (item.type === "image") {
		const url = item.url || item.thumbnailUrl;
		content = url ? (
			<RepeatedImage url={url} />
		) : (
			<StripPlaceholder
				icon={<ImageIcon className="h-4 w-4" />}
				label="Image"
			/>
		);
	} else if (item.type === "audio") {
		content = (
			<div className="relative h-full w-full bg-[#1E3A5F]">
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
						anchor="center"
					/>
				</div>
				<Music className="absolute bottom-1 left-1 h-3.5 w-3.5 text-[#7EC4FF]/80">
					<title>Audio</title>
				</Music>
			</div>
		);
	} else {
		content = (
			<StripPlaceholder
				icon={<ImageIcon className="h-4 w-4" />}
				label="Unknown"
			/>
		);
	}

	return (
		<div
			ref={ref}
			className="h-full w-full"
			data-testid="media-strip-preview"
			data-media-type={item.type}
		>
			{content}
		</div>
	);
}
