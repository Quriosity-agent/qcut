import { TimelineElement } from "@/types/timeline";

/**
 * Checks if any timeline elements overlap in time
 * Used to prevent invalid timeline states where elements occupy the same time range
 * @param elements - Array of timeline elements to check
 * @returns true if overlaps are detected, false otherwise
 */
export const checkElementOverlaps = (elements: TimelineElement[]): boolean => {
	// Sort elements by start time
	const sortedElements = [...elements].sort(
		(a, b) => a.startTime - b.startTime
	);

	for (let i = 0; i < sortedElements.length - 1; i++) {
		const current = sortedElements[i];
		const next = sortedElements[i + 1];

		const currentEnd =
			current.startTime +
			(current.duration - current.trimStart - current.trimEnd);

		// Check if current element overlaps with next element
		if (currentEnd > next.startTime) return true; // Overlap detected
	}

	return false; // No overlaps
};

/**
 * Resolves timeline element overlaps by adjusting element positions
 * Moves overlapping elements to prevent conflicts, maintaining chronological order
 * @param elements - Array of timeline elements that may have overlaps
 * @returns New array with resolved element positions (no overlaps)
 */
export const resolveElementOverlaps = (
	elements: TimelineElement[]
): TimelineElement[] => {
	// Sort elements by start time
	const sortedElements = [...elements].sort(
		(a, b) => a.startTime - b.startTime
	);
	const resolvedElements: TimelineElement[] = [];

	for (let i = 0; i < sortedElements.length; i++) {
		const current = { ...sortedElements[i] };

		if (resolvedElements.length > 0) {
			const previous = resolvedElements[resolvedElements.length - 1];
			const previousEnd =
				previous.startTime +
				(previous.duration - previous.trimStart - previous.trimEnd);

			// If current element would overlap with previous, push it after previous ends
			if (current.startTime < previousEnd) {
				current.startTime = previousEnd;
			}
		}

		resolvedElements.push(current);
	}

	return resolvedElements;
};
