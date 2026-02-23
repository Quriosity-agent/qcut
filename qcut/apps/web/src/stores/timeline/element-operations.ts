/**
 * Element Operations
 *
 * Operations for managing timeline elements (add, remove, move, update).
 * Uses OperationContext pattern for decoupling from Zustand.
 */

import type {
	TimelineTrack,
	TimelineElement,
	CreateTimelineElement,
} from "@/types/timeline";
import { validateElementTrackCompatibility } from "@/types/timeline";
import { checkElementOverlaps, resolveElementOverlaps } from "@/lib/timeline";
import {
	handleError,
	ErrorCategory,
	ErrorSeverity,
} from "@/lib/debug/error-handler";
import { generateUUID } from "@/lib/utils";
import type { OperationContext } from "./types";
import { getEffectiveDuration, getElementEndTime } from "./utils";

/**
 * Callbacks for side effects during element operations
 */
export interface AddElementCallbacks {
	selectElement: (trackId: string, elementId: string) => void;
	onFirstMediaElement?: (
		element: TimelineElement,
		totalElementsInTimeline: number
	) => void;
}

/**
 * Remove an element from a track (simple case without ripple)
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to remove
 * @param pushHistory - Whether to push to undo history
 */
export function removeElementSimpleOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string,
	pushHistory = true
): void {
	if (pushHistory) ctx.pushHistory();

	// Clear selection to avoid dangling references
	ctx.deselectElement(trackId, elementId);

	ctx.updateTracksAndSave(
		ctx
			.getTracks()
			.map((track) =>
				track.id === trackId
					? {
							...track,
							elements: track.elements.filter(
								(element) => element.id !== elementId
							),
						}
					: track
			)
			.filter((track) => track.elements.length > 0 || track.isMain)
	);
}

/**
 * Remove an element with ripple editing (shifts subsequent elements)
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to remove
 * @param pushHistory - Whether to push to undo history
 */
export function removeElementWithRippleOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string,
	pushHistory = true
): void {
	const tracks = ctx.getTracks();
	const track = tracks.find((t) => t.id === trackId);
	const element = track?.elements.find((e) => e.id === elementId);

	if (!element || !track) return;

	if (pushHistory) ctx.pushHistory();

	// Clear selection to avoid dangling references
	ctx.deselectElement(trackId, elementId);

	const elementStartTime = element.startTime;
	const elementDuration = getEffectiveDuration(element);
	const elementEndTime = elementStartTime + elementDuration;

	// Remove the element and shift all elements that come after it
	const updatedTracks = tracks
		.map((currentTrack) => {
			// Only apply ripple effects to the same track unless multi-track ripple is enabled
			const shouldApplyRipple = currentTrack.id === trackId;

			const updatedElements = currentTrack.elements
				.filter((currentElement) => {
					// Remove the target element
					if (currentElement.id === elementId && currentTrack.id === trackId) {
						return false;
					}
					return true;
				})
				.map((currentElement) => {
					// Only apply ripple effects if we should process this track
					if (!shouldApplyRipple) {
						return currentElement;
					}

					// Shift elements that start after the removed element
					if (currentElement.startTime >= elementEndTime) {
						return {
							...currentElement,
							startTime: Math.max(
								0,
								currentElement.startTime - elementDuration
							),
						};
					}
					return currentElement;
				});

			// Check for overlaps and resolve them if necessary
			const hasOverlaps = checkElementOverlaps(updatedElements);
			if (hasOverlaps) {
				// Resolve overlaps by adjusting element positions
				const resolvedElements = resolveElementOverlaps(updatedElements);
				return { ...currentTrack, elements: resolvedElements };
			}

			return { ...currentTrack, elements: updatedElements };
		})
		.filter((track) => track.elements.length > 0 || track.isMain);

	ctx.updateTracksAndSave(updatedTracks);
}

/**
 * Move an element from one track to another
 * @param ctx - Operation context
 * @param fromTrackId - ID of the source track
 * @param toTrackId - ID of the destination track
 * @param elementId - ID of the element to move
 */
export function moveElementToTrackOperation(
	ctx: OperationContext,
	fromTrackId: string,
	toTrackId: string,
	elementId: string
): void {
	// No-op if moving to the same track
	if (fromTrackId === toTrackId) return;

	ctx.pushHistory();

	const tracks = ctx.getTracks();
	const fromTrack = tracks.find((track) => track.id === fromTrackId);
	const toTrack = tracks.find((track) => track.id === toTrackId);
	const elementToMove = fromTrack?.elements.find(
		(element) => element.id === elementId
	);

	if (!elementToMove || !toTrack) return;

	// Validate element type compatibility with target track
	const validation = validateElementTrackCompatibility(elementToMove, toTrack);
	if (!validation.isValid) {
		handleError(
			new Error(validation.errorMessage || "Invalid drag operation"),
			{
				operation: "Timeline Drag Validation",
				category: ErrorCategory.VALIDATION,
				severity: ErrorSeverity.MEDIUM,
				metadata: {
					targetTrackId: toTrackId,
					elementId,
				},
			}
		);
		return;
	}

	const newTracks = tracks
		.map((track) => {
			if (track.id === fromTrackId) {
				return {
					...track,
					elements: track.elements.filter(
						(element) => element.id !== elementId
					),
				};
			}
			if (track.id === toTrackId) {
				return {
					...track,
					elements: [...track.elements, elementToMove],
				};
			}
			return track;
		})
		.filter((track) => track.elements.length > 0 || track.isMain);

	ctx.updateTracksAndSave(newTracks);
}

/**
 * Update the trim values for an element
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to update
 * @param trimStart - New trim start value
 * @param trimEnd - New trim end value
 * @param pushHistory - Whether to push to undo history
 */
export function updateElementTrimOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string,
	trimStart: number,
	trimEnd: number,
	pushHistory = true
): void {
	if (pushHistory) ctx.pushHistory();
	ctx.updateTracksAndSave(
		ctx.getTracks().map((track) =>
			track.id === trackId
				? {
						...track,
						elements: track.elements.map((element) =>
							element.id === elementId
								? { ...element, trimStart, trimEnd }
								: element
						),
					}
				: track
		)
	);
}

/**
 * Update the duration of an element
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to update
 * @param duration - New duration value
 * @param pushHistory - Whether to push to undo history
 */
export function updateElementDurationOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string,
	duration: number,
	pushHistory = true
): void {
	if (pushHistory) ctx.pushHistory();
	ctx.updateTracksAndSave(
		ctx.getTracks().map((track) =>
			track.id === trackId
				? {
						...track,
						elements: track.elements.map((element) =>
							element.id === elementId ? { ...element, duration } : element
						),
					}
				: track
		)
	);
}

/**
 * Update the start time of an element (simple case without ripple)
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to update
 * @param startTime - New start time
 * @param pushHistory - Whether to push to undo history
 */
export function updateElementStartTimeOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string,
	startTime: number,
	pushHistory = true
): void {
	if (pushHistory) ctx.pushHistory();
	const clampedStartTime = Math.max(0, startTime);
	ctx.updateTracksAndSave(
		ctx.getTracks().map((track) =>
			track.id === trackId
				? {
						...track,
						elements: track.elements.map((element) =>
							element.id === elementId
								? { ...element, startTime: clampedStartTime }
								: element
						),
					}
				: track
		)
	);
}

/**
 * Update the start time of an element with ripple editing
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to update
 * @param newStartTime - New start time
 */
export function updateElementStartTimeWithRippleOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string,
	newStartTime: number
): void {
	const clampedNewStartTime = Math.max(0, newStartTime);
	const tracks = ctx.getTracks();
	const track = tracks.find((t) => t.id === trackId);
	const element = track?.elements.find((e) => e.id === elementId);

	if (!element || !track) return;

	ctx.pushHistory();

	const oldStartTime = element.startTime;
	const effectiveDuration = getEffectiveDuration(element);
	const oldEndTime = oldStartTime + effectiveDuration;
	const newEndTime = clampedNewStartTime + effectiveDuration;
	const timeDelta = clampedNewStartTime - oldStartTime;

	// Update tracks based on multi-track ripple setting
	const updatedTracks = tracks.map((currentTrack) => {
		// Only apply ripple effects to the same track unless multi-track ripple is enabled
		const shouldApplyRipple = currentTrack.id === trackId;

		const updatedElements = currentTrack.elements.map((currentElement) => {
			if (currentElement.id === elementId && currentTrack.id === trackId) {
				return { ...currentElement, startTime: clampedNewStartTime };
			}

			// Only apply ripple effects if we should process this track
			if (!shouldApplyRipple) {
				return currentElement;
			}

			// For ripple editing, we need to move elements that come after the moved element
			const currentElementStart = currentElement.startTime;
			const currentElementEnd = getElementEndTime(currentElement);

			// If moving element to the right (positive delta)
			if (timeDelta > 0) {
				// Move elements that start after the original position of the moved element
				if (currentElementStart >= oldEndTime) {
					return {
						...currentElement,
						startTime: currentElementStart + timeDelta,
					};
				}
			}
			// If moving element to the left (negative delta)
			else if (timeDelta < 0) {
				// Move elements that start after the new position of the moved element
				if (
					currentElementStart >= newEndTime &&
					currentElementStart >= oldStartTime
				) {
					return {
						...currentElement,
						startTime: Math.max(0, currentElementStart + timeDelta),
					};
				}
			}

			return currentElement;
		});

		// Check for overlaps and resolve them if necessary
		const hasOverlaps = checkElementOverlaps(updatedElements);
		if (hasOverlaps) {
			// Resolve overlaps by adjusting element positions
			const resolvedElements = resolveElementOverlaps(updatedElements);
			return { ...currentTrack, elements: resolvedElements };
		}

		return { ...currentTrack, elements: updatedElements };
	});

	ctx.updateTracksAndSave(updatedTracks);
}

/**
 * Toggle the hidden state of an element
 * @param ctx - Operation context
 * @param trackId - ID of the track containing the element
 * @param elementId - ID of the element to toggle
 */
export function toggleElementHiddenOperation(
	ctx: OperationContext,
	trackId: string,
	elementId: string
): void {
	ctx.pushHistory();
	ctx.updateTracksAndSave(
		ctx.getTracks().map((track) =>
			track.id === trackId
				? {
						...track,
						elements: track.elements.map((element) =>
							element.id === elementId
								? { ...element, hidden: !element.hidden }
								: element
						),
					}
				: track
		)
	);
}

/**
 * Toggle the mute state of a track
 * @param ctx - Operation context
 * @param trackId - ID of the track to toggle
 */
export function toggleTrackMuteOperation(
	ctx: OperationContext,
	trackId: string
): void {
	ctx.pushHistory();
	ctx.updateTracksAndSave(
		ctx
			.getTracks()
			.map((track) =>
				track.id === trackId ? { ...track, muted: !track.muted } : track
			)
	);
}

/**
 * Check if an element would overlap with existing elements at a given position
 * @param tracks - Current timeline tracks
 * @param trackId - ID of the track to check
 * @param startTime - Start time of the potential element
 * @param duration - Duration of the potential element
 * @param excludeElementId - Optional element ID to exclude from check
 * @returns true if there would be an overlap
 */
export function checkElementOverlapOperation(
	tracks: TimelineTrack[],
	trackId: string,
	startTime: number,
	duration: number,
	excludeElementId?: string
): boolean {
	const track = tracks.find((t) => t.id === trackId);
	if (!track) return false;

	return track.elements.some((element) => {
		const elementEnd = getElementEndTime(element);

		if (element.id === excludeElementId) {
			return false;
		}

		return (
			(startTime >= element.startTime && startTime < elementEnd) ||
			(startTime + duration > element.startTime &&
				startTime + duration <= elementEnd) ||
			(startTime < element.startTime && startTime + duration > elementEnd)
		);
	});
}
