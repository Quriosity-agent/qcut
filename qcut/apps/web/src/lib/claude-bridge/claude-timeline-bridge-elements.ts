import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore } from "@/stores/media/media-store";
import { normalizeMediaPortraitAdjustments } from "@qcut/editor-core";
import type {
	CaptionElement,
	MediaElement,
	MediaPortraitAdjustments,
	StickerElement,
} from "@/types/timeline";
import { DEFAULT_MEDIA_ENHANCEMENTS } from "@/lib/video/video-properties";
import {
	buildLegacyColorAdjustments,
	normalizeMediaColorSettings,
} from "@/lib/color/color-properties";
import {
	mergeMediaColorSettings,
	readMediaAdjustmentsPatch,
} from "@/lib/color/color-settings-merge";
import type { ClaudeElement } from "../../../../../electron/types/claude-api";
import { parseClaudeMediaAudioChanges } from "./claude-media-audio-changes";
import { resolveClaudePlacement } from "./claude-placement";
import { debugLog, debugWarn, debugError } from "@/lib/debug/debug-config";
import {
	findTrackByElementId,
	isClaudeMediaElementType,
	addClaudeMediaElement,
	addClaudeTextElement,
	addClaudeAdjustmentElement,
	addClaudeStickerElement,
	addClaudeCaptionElement,
	addClaudeMarkdownElement,
	addClaudeRemotionElement,
	getClaudeAdjustmentFields,
	getClaudeTextProperties,
	getClaudeMediaTimingProperties,
	resolveClaudeStickerRuntime,
	parseClaudeMediaFilterStack,
	readClaudeMediaVisualFields,
} from "./claude-timeline-bridge-helpers";
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";
import {
	assertTimelineProjectActive,
	readRequiredTimelineProjectId,
} from "./claude-timeline-project-guard";
import { resolveClaudeStickerGeometry } from "./claude-sticker-geometry";
import { parseTimelineColorLabel } from "@/lib/timeline/timeline-color-labels";
import { getTimelineElementDuration } from "@/lib/timeline";
import {
	describeOccupancyConflict,
	formatSeconds,
} from "@/lib/timeline-occupancy";

function timelineElementFromTransport({ candidate }: { candidate: unknown }): {
	element: Partial<ClaudeElement>;
	projectId: string;
} {
	if (
		typeof candidate !== "object" ||
		candidate === null ||
		Array.isArray(candidate)
	) {
		throw new Error("Invalid timeline element payload");
	}
	const record = candidate as Record<string, unknown>;
	const projectId = readRequiredTimelineProjectId({
		candidate: record.projectId,
	});
	const element = Object.fromEntries(
		Object.entries(candidate).filter(
			([key]) =>
				key !== "requestId" && key !== "correlationId" && key !== "projectId"
		)
	) as Partial<ClaudeElement>;
	return { element, projectId };
}

/**
 * Why the store refused to move an element to `startTime`. The store only
 * reports refusal, so this re-reads the timeline to name the cause: a locked
 * track, or the clip already on the span with the next free start.
 */
function describeRefusedStartTime({
	trackId,
	elementId,
	startTime,
}: {
	trackId: string;
	elementId: string;
	startTime: number;
}): string {
	const tracks = useTimelineStore.getState().tracks;
	const track = tracks.find((candidate) => candidate.id === trackId);
	const element = track?.elements.find(
		(candidate) => candidate.id === elementId
	);
	if (!track || !element) return `Element not found: ${elementId}`;

	// A grouped element moves with its group, so every lane the group touches
	// must be editable, and its own groupmates are not obstructions.
	const groupId = element.groupId;
	const lockedTrack = tracks.find(
		(candidate) =>
			candidate.locked &&
			(candidate.id === trackId ||
				(groupId !== undefined &&
					candidate.elements.some((other) => other.groupId === groupId)))
	);
	if (lockedTrack) return `Track "${lockedTrack.name}" is locked`;

	const fps = useProjectStore.getState().activeProject?.fps ?? 30;
	const conflict = describeOccupancyConflict({
		track: groupId
			? {
					...track,
					elements: track.elements.filter(
						(other) => other.id === elementId || other.groupId !== groupId
					),
				}
			: track,
		startTime: Math.max(0, startTime),
		duration: getTimelineElementDuration({ element, fps }),
		excludeElementId: elementId,
		fps,
	});
	if (conflict) return conflict.message;
	return groupId
		? `Moving "${element.name}" to ${formatSeconds(startTime)} would put another clip in its group on top of an existing clip`
		: `The editor refused to move "${element.name}" to ${formatSeconds(startTime)}`;
}

/** Whether an element update applied, and why not when it did not. */
export interface ElementChangesResult {
	applied: boolean;
	error?: string;
	/** Fields the element type has no use for; the rest were applied. */
	ignoredFields?: string[];
}

/** Keys every element patch may carry (ids and timing). */
const COMMON_PATCH_FIELDS = new Set([
	"elementId",
	"type",
	"startTime",
	"colorLabel",
	"trimStart",
	"trimEnd",
	"duration",
	"endTime",
]);

/**
 * The fields a patch can change per element type. Text patches are schema
 * driven (`getClaudeTextProperties`) and are not checked here.
 */
const PATCH_FIELDS_BY_TYPE: Partial<Record<string, ReadonlySet<string>>> = {
	media: new Set([
		"name",
		"fitMode",
		"x",
		"y",
		"rotation",
		"scaleX",
		"scaleY",
		"opacity",
		"playbackRate",
		"speedKeyframes",
		"reverse",
		"freezeFrameTime",
		"freezeFrameDuration",
		"preservePitch",
		"frameInterpolation",
		"style",
		"portraitAdjustments",
		"enhancements",
		"keyframes",
		"audio",
		"filterStack",
		"color",
		"adjustments",
	]),
	adjustment: new Set(["name", "opacity", "color", "adjustments", "masks"]),
	markdown: new Set(["content"]),
	captions: new Set(["content", "language", "style"]),
	sticker: new Set([
		"mediaId",
		"x",
		"y",
		"width",
		"height",
		"stickerGeometrySpace",
		"stickerId",
		"stickerAssetId",
		"stickerRuntime",
		"rotation",
		"opacity",
	]),
};

/**
 * Fields the element's type cannot use. A patch made only of such fields is
 * an error (it used to answer `updated: true` while changing nothing); a
 * patch that also carries supported fields applies them and reports the rest.
 */
export function unsupportedPatchFields({
	elementType,
	changes,
}: {
	elementType: string;
	changes: Record<string, unknown>;
}): string[] {
	const typed = PATCH_FIELDS_BY_TYPE[elementType];
	if (!typed) return [];
	return Object.keys(changes).filter(
		(key) =>
			changes[key] !== undefined &&
			!COMMON_PATCH_FIELDS.has(key) &&
			!typed.has(key)
	);
}

export const applyElementChanges = ({
	elementId,
	changes,
	pushHistory,
}: {
	elementId: string;
	changes: Partial<ClaudeElement>;
	pushHistory: boolean;
}): ElementChangesResult => {
	try {
		const timelineStore = useTimelineStore.getState();
		const track = findTrackByElementId(timelineStore.tracks, elementId);
		if (!track) {
			debugWarn(
				"[ClaudeTimelineBridge] Could not find track for element:",
				elementId
			);
			return { applied: false, error: `Element not found: ${elementId}` };
		}

		const element = track.elements.find(
			(candidate) => candidate.id === elementId
		);
		if (!element) {
			debugWarn(
				"[ClaudeTimelineBridge] Could not find element in resolved track:",
				elementId
			);
			return { applied: false, error: `Element not found: ${elementId}` };
		}
		const ignoredFields = unsupportedPatchFields({
			elementType: element.type,
			changes: changes as Record<string, unknown>,
		});
		if (
			ignoredFields.length > 0 &&
			ignoredFields.length ===
				Object.keys(changes).filter(
					(key) =>
						(changes as Record<string, unknown>)[key] !== undefined &&
						key !== "elementId" &&
						key !== "type"
				).length
		) {
			throw new Error(
				`No supported field for a ${element.type} element in: ${ignoredFields.join(", ")}`
			);
		}
		// Validate up front: a malformed stack must fail the whole update
		// before any state (history, timing, trims) has been touched.
		const parsedFilterStack =
			changes.filterStack !== undefined
				? parseClaudeMediaFilterStack({ value: changes.filterStack })
				: undefined;
		const parsedAudio =
			changes.audio !== undefined && element.type === "media"
				? parseClaudeMediaAudioChanges({ element, value: changes.audio })
				: undefined;
		const updatesColorLabel = Object.hasOwn(changes, "colorLabel");
		const colorLabel = updatesColorLabel
			? parseTimelineColorLabel({ value: changes.colorLabel })
			: undefined;

		const styleChanges =
			typeof changes.style === "object" &&
			changes.style !== null &&
			!Array.isArray(changes.style)
				? changes.style
				: undefined;
		const updatesTextAnimationPreset =
			changes.textAnimationPreset !== undefined ||
			styleChanges?.textAnimationPreset !== undefined;
		const textUpdates =
			element.type === "text"
				? {
						...getClaudeTextProperties({
							element: {
								...(updatesTextAnimationPreset &&
								element.textAnimations !== undefined
									? { textAnimations: element.textAnimations }
									: {}),
								...changes,
							} as Partial<ClaudeElement> & Record<string, unknown>,
						}),
						...(typeof changes.content === "string"
							? { content: changes.content }
							: {}),
					}
				: null;

		if (
			element.type === "media" &&
			changes.portraitAdjustments !== undefined &&
			(typeof changes.portraitAdjustments !== "object" ||
				changes.portraitAdjustments === null ||
				Array.isArray(changes.portraitAdjustments))
		) {
			throw new Error("portraitAdjustments must be an object");
		}

		if (
			element.type === "media" &&
			changes.enhancements !== undefined &&
			(typeof changes.enhancements !== "object" ||
				changes.enhancements === null ||
				Array.isArray(changes.enhancements))
		) {
			throw new Error("enhancements must be an object");
		}
		// Canvas placement and fit, checked like the other media payloads.
		const visualUpdates =
			element.type === "media"
				? readClaudeMediaVisualFields({
						element: changes as Record<string, unknown>,
					})
				: {};
		// A clip's grade: `color` is a partial MediaColorSettings merged into the
		// current grade (the colour panel edits one value at a time the same
		// way); `adjustments` are the eight legacy basic fields. Checked before
		// anything moves, like the other media payloads.
		const colorPatch =
			element.type === "media" &&
			(changes as Record<string, unknown>).color !== undefined
				? (changes as Record<string, unknown>).color
				: undefined;
		if (
			colorPatch !== undefined &&
			(typeof colorPatch !== "object" ||
				colorPatch === null ||
				Array.isArray(colorPatch))
		) {
			throw new Error("color must be an object (a partial colour grade)");
		}
		const adjustmentsPatch =
			element.type === "media" && changes.adjustments !== undefined
				? readMediaAdjustmentsPatch({ value: changes.adjustments })
				: undefined;

		// The move goes first because the store may refuse it (a locked track
		// or an occupied span); a refused move must fail the update before any
		// other change lands. When it succeeds it has already pushed history.
		const requestedStart =
			typeof changes.startTime === "number" ? changes.startTime : undefined;
		if (requestedStart !== undefined) {
			const moved = timelineStore.updateElementStartTime(
				track.id,
				elementId,
				requestedStart,
				pushHistory
			);
			if (!moved) {
				return {
					applied: false,
					error: describeRefusedStartTime({
						trackId: track.id,
						elementId,
						startTime: requestedStart,
					}),
				};
			}
		} else if (pushHistory) {
			timelineStore.pushHistory();
		}

		if (updatesColorLabel) {
			timelineStore.setColorLabelForElements({
				elements: [{ trackId: track.id, elementId }],
				colorLabel,
				pushHistory: false,
			});
		}

		if (
			typeof changes.trimStart === "number" ||
			typeof changes.trimEnd === "number"
		) {
			timelineStore.updateElementTrim(
				track.id,
				elementId,
				changes.trimStart ?? element.trimStart,
				changes.trimEnd ?? element.trimEnd,
				false
			);
		}

		const isMarkdown = element.type === "markdown";
		if (typeof changes.duration === "number" && changes.duration > 0) {
			if (isMarkdown) {
				timelineStore.updateMarkdownElement(
					track.id,
					elementId,
					{ duration: changes.duration },
					false
				);
			} else {
				timelineStore.updateElementDuration(
					track.id,
					elementId,
					changes.duration,
					false
				);
			}
		} else if (typeof changes.endTime === "number") {
			const resolvedStart = changes.startTime ?? element.startTime;
			const resolvedDuration = changes.endTime - resolvedStart;
			if (resolvedDuration > 0) {
				if (isMarkdown) {
					timelineStore.updateMarkdownElement(
						track.id,
						elementId,
						{ duration: resolvedDuration },
						false
					);
				} else {
					timelineStore.updateElementDuration(
						track.id,
						elementId,
						resolvedDuration,
						false
					);
				}
			}
		}

		if (textUpdates) {
			if (Object.keys(textUpdates).length > 0) {
				timelineStore.updateTextElement(
					track.id,
					elementId,
					textUpdates,
					false
				);
			}
		}

		if (element.type === "markdown") {
			const markdownUpdates: Record<string, unknown> = {};
			if (typeof changes.content === "string") {
				markdownUpdates.markdownContent = changes.content;
			}
			if (Object.keys(markdownUpdates).length > 0) {
				timelineStore.updateMarkdownElement(
					track.id,
					elementId,
					markdownUpdates,
					false
				);
			}
		}

		if (element.type === "captions") {
			// Captions expose their text as `content` in the export snapshot, so
			// the same key is accepted back; style merges over the current look.
			const captionUpdates: Partial<
				Pick<CaptionElement, "text" | "language" | "style">
			> = {};
			if (typeof changes.content === "string") {
				captionUpdates.text = changes.content;
			}
			if (typeof changes.language === "string") {
				captionUpdates.language = changes.language;
			}
			if (styleChanges) {
				captionUpdates.style =
					styleChanges as unknown as CaptionElement["style"];
			}
			if (Object.keys(captionUpdates).length > 0) {
				timelineStore.updateCaptionElement(
					track.id,
					elementId,
					captionUpdates,
					false
				);
			}
		}
		if (element.type === "media") {
			const timingUpdates = getClaudeMediaTimingProperties({
				element: changes,
			});
			if (Object.keys(timingUpdates).length > 0) {
				timelineStore.updateMediaTiming(
					track.id,
					elementId,
					timingUpdates,
					false
				);
			}

			const mediaUpdates: Record<string, unknown> = { ...visualUpdates };
			if (typeof changes.name === "string" && changes.name.trim()) {
				mediaUpdates.name = changes.name.trim();
			}
			if (typeof changes.style?.volume === "number") {
				mediaUpdates.volume = changes.style.volume;
			}
			if (changes.portraitAdjustments !== undefined) {
				mediaUpdates.portraitAdjustments = normalizeMediaPortraitAdjustments({
					adjustments:
						changes.portraitAdjustments as Partial<MediaPortraitAdjustments>,
				});
			}
			if (changes.enhancements !== undefined) {
				mediaUpdates.enhancements = {
					...DEFAULT_MEDIA_ENHANCEMENTS,
					...element.enhancements,
					...(changes.enhancements as Partial<
						typeof DEFAULT_MEDIA_ENHANCEMENTS
					>),
				};
			}
			if (changes.keyframes !== undefined) {
				if (
					typeof changes.keyframes !== "object" ||
					changes.keyframes === null ||
					Array.isArray(changes.keyframes)
				) {
					throw new Error("keyframes must be an object");
				}
				mediaUpdates.keyframes = changes.keyframes as MediaElement["keyframes"];
			}
			if (parsedAudio !== undefined) {
				mediaUpdates.audio = parsedAudio;
			}
			if (parsedFilterStack !== undefined) {
				mediaUpdates.filterStack = parsedFilterStack;
			}
			if (colorPatch !== undefined || adjustmentsPatch !== undefined) {
				const current = normalizeMediaColorSettings({ element });
				const merged = mergeMediaColorSettings({
					current,
					patch: {
						...((colorPatch as Record<string, unknown>) ?? {}),
						...(adjustmentsPatch
							? {
									basic: {
										...(((colorPatch as Record<string, unknown>)?.basic as
											| Record<string, unknown>
											| undefined) ?? {}),
										...adjustmentsPatch,
									},
								}
							: {}),
					},
				});
				const next = normalizeMediaColorSettings({
					element: { color: merged },
				});
				mediaUpdates.color = next;
				// The legacy mirror of `color.basic`, kept in step like the panel does.
				mediaUpdates.adjustments = buildLegacyColorAdjustments({
					settings: next,
				});
			}
			if (Object.keys(mediaUpdates).length > 0) {
				timelineStore.updateMediaElement(
					track.id,
					elementId,
					mediaUpdates,
					false
				);
			}
		}

		if (element.type === "adjustment") {
			const adjustmentUpdates = getClaudeAdjustmentFields({
				element: changes as Partial<ClaudeElement> & Record<string, unknown>,
			});
			if (Object.keys(adjustmentUpdates).length > 0) {
				timelineStore.updateAdjustmentElement(
					track.id,
					elementId,
					adjustmentUpdates,
					false
				);
			}
		}

		if (element.type === "sticker") {
			const stickerUpdates: Partial<StickerElement> = {};
			const replacesMedia = typeof changes.mediaId === "string";
			const replacementMedia = replacesMedia
				? useMediaStore
						.getState()
						.mediaItems.find((item) => item.id === changes.mediaId)
				: undefined;
			if (replacesMedia && !replacementMedia) {
				throw new Error(
					`Sticker replacement media could not be resolved: ${changes.mediaId}`
				);
			}
			const updatesGeometry =
				changes.x !== undefined ||
				changes.y !== undefined ||
				changes.width !== undefined ||
				changes.height !== undefined;
			if (updatesGeometry) {
				const canvasSize = useProjectStore.getState().activeProject
					?.canvasSize ?? {
					width: 1920,
					height: 1080,
				};
				Object.assign(
					stickerUpdates,
					resolveClaudeStickerGeometry({
						canvasSize,
						current: element,
						patch: changes,
						space: changes.stickerGeometrySpace,
					})
				);
			}
			if (replacesMedia) {
				stickerUpdates.mediaId = changes.mediaId;
			}
			if (typeof changes.stickerId === "string") {
				stickerUpdates.stickerId = changes.stickerId;
			}
			if (typeof changes.stickerAssetId === "string") {
				stickerUpdates.stickerAssetId = changes.stickerAssetId;
			}
			const hasRuntimePatch = Object.hasOwn(changes, "stickerRuntime");
			if (hasRuntimePatch || replacesMedia) {
				const runtimeCandidate =
					!hasRuntimePatch || changes.stickerRuntime === null
						? replacementMedia?.metadata?.stickerRuntime
						: changes.stickerRuntime;
				stickerUpdates.stickerRuntime =
					runtimeCandidate === undefined
						? undefined
						: resolveClaudeStickerRuntime({
								candidate: runtimeCandidate,
							});
			}
			if (typeof changes.rotation === "number") {
				stickerUpdates.rotation = changes.rotation;
			}
			if (typeof changes.opacity === "number") {
				stickerUpdates.opacity = changes.opacity;
			}
			if (Object.keys(stickerUpdates).length > 0) {
				timelineStore.updateStickerElement(
					track.id,
					elementId,
					stickerUpdates,
					false
				);
			}
		}

		return ignoredFields.length > 0
			? { applied: true, ignoredFields }
			: { applied: true };
	} catch (error) {
		debugError(
			"[ClaudeTimelineBridge] Failed to apply element changes:",
			error
		);
		return {
			applied: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

export function setupElementHandlers({
	claudeAPI,
}: {
	claudeAPI: ClaudeTimelineBridgeAPI;
}): void {
	// Handle element addition from Claude
	claudeAPI.onAddElement(async (candidate: unknown) => {
		try {
			const { element: request, projectId } = timelineElementFromTransport({
				candidate,
			});
			assertTimelineProjectActive({ projectId });
			const element = resolveClaudePlacement({
				element: request,
				tracks: useTimelineStore.getState().tracks,
				fps: useProjectStore.getState().activeProject?.fps ?? 30,
			});
			const elementType = (element as Record<string, unknown>).type;
			debugLog("[ClaudeTimelineBridge] Adding element:", element);

			const timelineStore = useTimelineStore.getState();
			let addedElementId: string;

			if (isClaudeMediaElementType({ type: element.type })) {
				addedElementId = await addClaudeMediaElement({
					element,
					timelineStore,
					projectId,
				});
			} else if (element.type === "text") {
				addedElementId = addClaudeTextElement({
					element,
					timelineStore,
				});
			} else if (element.type === "adjustment") {
				addedElementId = addClaudeAdjustmentElement({
					element,
					timelineStore,
				});
			} else if (element.type === "markdown") {
				addedElementId = addClaudeMarkdownElement({
					element,
					timelineStore,
				});
			} else if (element.type === "sticker") {
				addedElementId = await addClaudeStickerElement({
					element,
					projectId,
					timelineStore,
				});
			} else if (element.type === "remotion") {
				addedElementId = await addClaudeRemotionElement({
					element,
					projectId,
					timelineStore,
				});
			} else if (element.type === "captions" || elementType === "caption") {
				console.log(
					"[CaptionDebug] onAddElement matched caption type:",
					elementType
				);
				addedElementId = addClaudeCaptionElement({
					element:
						elementType === "caption"
							? { ...element, type: "captions" }
							: element,
					timelineStore,
				});
			} else {
				throw new Error(`Unsupported element type: ${String(elementType)}`);
			}

			debugLog(
				"[ClaudeTimelineBridge] Added element with renderer acknowledgement:",
				addedElementId
			);
		} catch (error) {
			debugError("[ClaudeTimelineBridge] Failed to add element:", error);
			throw error instanceof Error ? error : new Error(String(error));
		}
	});

	// Handle element update from Claude
	claudeAPI.onUpdateElement((data: any) => {
		try {
			debugLog("[ClaudeTimelineBridge] Updating element:", data.elementId);
			const { applied } = applyElementChanges({
				elementId: data.elementId,
				changes: data.changes,
				pushHistory: true,
			});
			if (!applied) {
				return;
			}
			debugLog("[ClaudeTimelineBridge] Updated element:", data.elementId);
		} catch (error) {
			debugError(
				"[ClaudeTimelineBridge] Failed to handle element update:",
				error
			);
		}
	});
}
