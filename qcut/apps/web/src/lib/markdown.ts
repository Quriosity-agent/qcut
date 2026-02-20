import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { debugError } from "@/lib/debug-config";

interface StripMarkdownSyntaxParams {
	markdown: string;
	maxLength?: number;
}

export function stripMarkdownSyntax({
	markdown,
	maxLength,
}: StripMarkdownSyntaxParams): string {
	try {
		const normalized = markdown
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/`([^`]+)`/g, "$1")
			.replace(/^#{1,6}\s+/gm, "")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/_([^_]+)_/g, "$1")
			.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/^\s*[-*+]\s+/gm, "")
			.replace(/^\s*\d+\.\s+/gm, "")
			.replace(/^>\s+/gm, "")
			.replace(/\|/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		if (!maxLength || normalized.length <= maxLength) {
			return normalized;
		}

		return `${normalized.slice(0, maxLength).trimEnd()}...`;
	} catch (error) {
		debugError("[markdown] Failed to strip markdown syntax:", error);
		return markdown;
	}
}

interface ClampMarkdownDurationParams {
	duration: number;
}

export function clampMarkdownDuration({
	duration,
}: ClampMarkdownDurationParams): number {
	try {
		if (!Number.isFinite(duration)) {
			return TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION;
		}

		return Math.min(
			TIMELINE_CONSTANTS.MARKDOWN_MAX_DURATION,
			Math.max(TIMELINE_CONSTANTS.MARKDOWN_MIN_DURATION, duration)
		);
	} catch (error) {
		debugError("[markdown] Failed to clamp markdown duration:", error);
		return TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION;
	}
}
