import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { TranscriptionSegment } from "@/types/captions";
import type { SubtitleStyle } from "@/types/timeline";
import type { WordItem } from "@/types/word-timeline";
import {
	captionShadowsToCSS,
	cssFontWeight,
	getCaptionAnimationState,
	resolveSecondaryLineStyle,
	resolveSubtitleStyle,
	subtitleStyleToCSS,
} from "@/lib/captions/subtitle-style";
import { KaraokeRenderer } from "@/components/editor/preview-panel/karaoke-renderer";

interface CaptionsDisplayProps {
	segments: TranscriptionSegment[];
	currentTime: number;
	isVisible?: boolean;
	className?: string;
	style?: CSSProperties;
	subtitleStyle?: Partial<SubtitleStyle>;
	/** Word-level timing data for karaoke rendering */
	words?: WordItem[];
	canvasScale?: number;
	/** A bilingual caption's second-language line, under the text. */
	secondaryText?: string;
	/** The project frame rate, for the caption's fade frames. */
	fps?: number;
}

/** Renders active caption text with optional karaoke word highlighting. */
export function CaptionsDisplay({
	segments,
	currentTime,
	isVisible = true,
	className,
	style,
	subtitleStyle,
	words,
	canvasScale = 1,
	secondaryText,
	fps,
}: CaptionsDisplayProps) {
	const resolved = resolveSubtitleStyle(subtitleStyle);
	const secondary = resolveSecondaryLineStyle(resolved);
	const captionCSS = subtitleStyleToCSS({ style: resolved, canvasScale });
	const softShadows = captionShadowsToCSS({ style: resolved, canvasScale });
	const karaokeMode = resolved.karaokeMode ?? "none";

	// Find the active caption segment based on current time
	const activeSegment = segments.find(
		(segment) => currentTime >= segment.start && currentTime <= segment.end
	);

	// Filter words within the active segment's time range for karaoke
	// Must be called unconditionally (React hooks rule)
	const segmentWords = useMemo(() => {
		if (
			karaokeMode === "none" ||
			!words ||
			words.length === 0 ||
			!activeSegment
		)
			return [];
		return words.filter(
			(w) =>
				w.type === "word" &&
				w.start >= activeSegment.start - 0.05 &&
				w.end <= activeSegment.end + 0.05
		);
	}, [karaokeMode, words, activeSegment]);

	if (!isVisible || !segments.length || !activeSegment) {
		return null;
	}

	const alignMap: Record<SubtitleStyle["position"]["align"], string> = {
		top: "flex-start",
		center: "center",
		bottom: "flex-end",
	};

	const useKaraoke = karaokeMode !== "none" && segmentWords.length > 0;
	const animation = getCaptionAnimationState({
		style: resolved,
		startTime: activeSegment.start,
		currentTime,
		endTime: activeSegment.end,
		fps,
	});
	const horizontalAlignMap: Record<SubtitleStyle["textAlign"], string> = {
		left: "flex-start",
		center: "center",
		right: "flex-end",
	};

	return (
		<div
			className={cn(
				"absolute bottom-0 left-0 right-0 top-0 z-10 pointer-events-none",
				className
			)}
			style={{
				...style,
				display: "flex",
				justifyContent: horizontalAlignMap[resolved.textAlign],
				alignItems: alignMap[resolved.position.align],
				padding: `${20 * canvasScale}px`,
			}}
		>
			<div
				data-testid="caption-layout"
				style={{
					display: "flex",
					justifyContent: horizontalAlignMap[resolved.textAlign],
					width: "100%",
					opacity: animation.opacity,
					transform: `translate(${animation.offsetX * canvasScale}px, ${animation.offsetY * canvasScale}px)`,
				}}
			>
				{useKaraoke ? (
					<KaraokeRenderer
						words={segmentWords}
						currentTime={currentTime}
						style={resolved}
						canvasScale={canvasScale}
					/>
				) : (
					<div
						style={{
							...captionCSS,
							// A line break in the caption is a line break on screen,
							// as in both exports.
							whiteSpace: "pre-line",
							wordWrap: "break-word",
							overflowWrap: "break-word",
							hyphens: "auto",
							// The shadow underlay sits behind the text, above the box.
							...(softShadows
								? { position: "relative", isolation: "isolate" }
								: {}),
						}}
					>
						{softShadows && softShadows !== "none" ? (
							// The same lines, see-through, casting the soft shadows:
							// every shadow lies under every line, as in the exports.
							<div
								aria-hidden
								data-testid="caption-shadows"
								style={{
									position: "absolute",
									inset: 0,
									zIndex: -1,
									padding: captionCSS.padding,
									color: "transparent",
									WebkitTextStrokeColor: "transparent",
									textShadow: softShadows,
								}}
							>
								{activeSegment.text.trim()}
								<SecondaryLine
									text={secondaryText}
									secondary={secondary}
									canvasScale={canvasScale}
									color="transparent"
								/>
							</div>
						) : null}
						{activeSegment.text.trim()}
						<SecondaryLine
							text={secondaryText}
							secondary={secondary}
							canvasScale={canvasScale}
							color={secondary.fontColor}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * A bilingual caption's second-language line: its own block in the same
 * box, in its own font, spacing and weight; it keeps the caption's line
 * spacing, outline and shadows, as both exports draw it.
 */
function SecondaryLine({
	text,
	secondary,
	canvasScale,
	color,
}: {
	text?: string;
	secondary: ReturnType<typeof resolveSecondaryLineStyle>;
	canvasScale: number;
	color: string;
}) {
	if (!text?.trim()) return null;
	return (
		<div
			data-testid={color === "transparent" ? undefined : "caption-secondary"}
			style={{
				fontFamily: `${secondary.fontFamily}, sans-serif`,
				fontSize: `${secondary.fontSize * canvasScale}px`,
				fontWeight: cssFontWeight(secondary.fontWeight),
				fontStyle: secondary.italic ? "italic" : "normal",
				letterSpacing: `${secondary.letterSpacing * canvasScale}px`,
				color,
			}}
		>
			{text.trim()}
		</div>
	);
}

export default CaptionsDisplay;
