/**
 * Read-back verification for `editor timeline apply`: after the manifest is
 * applied, the timeline is read again and every requested track, element and
 * transition field is compared with what the editor now holds.
 *
 * @module electron/native-pipeline/editor/editor-timeline-apply-verify
 */
import {
	aliasFor,
	collectTransitions,
	isRecord,
	mapReference,
	stringValue,
	valuesMatch,
	type JsonRecord,
	type ManifestElement,
	type TimelineManifest,
	type TimelineSnapshot,
} from "./editor-timeline-manifest.js";

const TEXT_VERIFY_KEYS = [
	"content",
	"text",
	"language",
	"fontSize",
	"fontFamily",
	"fontAsset",
	"jianyingTextStyle",
	"textTemplateId",
	"stylePresetId",
	"color",
	"backgroundColor",
	"textAlign",
	"fontWeight",
	"fontStyle",
	"textDecoration",
	"x",
	"y",
	"width",
	"height",
	"rotation",
	"opacity",
	"letterSpacing",
	"lineHeight",
	"verticalAlign",
	"strokeColor",
	"strokeWidth",
	"strokeOpacity",
	"backgroundOpacity",
	"backgroundRadius",
	"backgroundPadding",
	"shadowColor",
	"shadowOpacity",
	"shadowOffsetX",
	"shadowOffsetY",
	"shadowBlur",
	"glowColor",
	"glowOpacity",
	"glowBlur",
	"curve",
	"animationType",
	"animationDuration",
	"animationDelay",
	"textAnimations",
	"textAnimationPreset",
	"keyframes",
	"blendMode",
	"trackingTargetId",
	"trackingOffsetX",
	"trackingOffsetY",
	"trackingRotation",
] as const;

const MEDIA_VERIFY_KEYS = [
	"colorLabel",
	"volume",
	"audioFadeIn",
	"audioFadeOut",
	"fitMode",
	"x",
	"y",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
	"blendMode",
	"blendEnabled",
	"keyframes",
	"playbackRate",
	"speedKeyframes",
	"reverse",
	"freezeFrameTime",
	"freezeFrameDuration",
	"preservePitch",
	"frameInterpolation",
	"timelineDuration",
	"filterStack",
	// The grade, both representations: `color` subset-compares (the editor
	// stores a normalized full grade), while `adjustments` read back as the
	// mirror of the effective `color.basic` — a manifest whose two sides
	// disagree fails here instead of silently losing one of them (Q4,
	// 问题记录_片中文字_QCut1702).
	"color",
	"adjustments",
] as const;

const STICKER_VERIFY_KEYS = [
	"stickerId",
	"stickerAssetId",
	"mediaId",
	"stickerRuntime",
	"x",
	"y",
	"width",
	"height",
	"rotation",
	"opacity",
	"maintainAspectRatio",
	"animationInType",
	"animationInDuration",
	"animationOutType",
	"animationOutDuration",
	"animationLoopType",
	"animationLoopIntensity",
] as const;

/** An adjustment layer's grade verifies like a clip's. */
const ADJUSTMENT_VERIFY_KEYS = ["color", "adjustments", "opacity"] as const;

const TRANSITION_VERIFY_KEYS = [
	"type",
	"presetId",
	"duration",
	"direction",
	"easing",
	"engine",
	"packageHash",
	"tuning",
	"maskShape",
] as const;

const MEDIA_FAMILY_TYPES = new Set(["media", "video", "audio", "image"]);

function expectedManifestTrims({ expected }: { expected: ManifestElement }): {
	trimStart: number;
	trimEnd: number;
} {
	return {
		trimStart: typeof expected.trimStart === "number" ? expected.trimStart : 0,
		trimEnd: typeof expected.trimEnd === "number" ? expected.trimEnd : 0,
	};
}

function expectedReadBackValue({
	expected,
	key,
}: {
	expected: ManifestElement;
	key: string;
}): unknown {
	const value = expected[key];
	if (key === "textAnimationPreset" && isRecord(value)) {
		return stringValue(value, "presetId");
	}
	// The timeline reports timeline seconds: (source duration − trims) ÷
	// playbackRate. The manifest carries source seconds, so derive what the
	// editor must have stored — a 2× audio clip occupies half its source span.
	// Speed keyframes and freeze frames reshape the span in ways this formula
	// cannot express, so those elements skip the derived check.
	if (
		key === "timelineDuration" &&
		MEDIA_FAMILY_TYPES.has(expected.type ?? "") &&
		typeof expected.duration === "number" &&
		!(
			Array.isArray(expected.speedKeyframes) &&
			expected.speedKeyframes.length > 0
		) &&
		expected.freezeFrameDuration === undefined &&
		expected.freezeFrameTime === undefined
	) {
		const { trimStart, trimEnd } = expectedManifestTrims({ expected });
		const playbackRate =
			typeof expected.playbackRate === "number" &&
			Number.isFinite(expected.playbackRate) &&
			expected.playbackRate > 0
				? expected.playbackRate
				: 1;
		return Math.max(0, expected.duration - trimStart - trimEnd) / playbackRate;
	}
	if (
		key !== "duration" ||
		!MEDIA_FAMILY_TYPES.has(expected.type ?? "") ||
		typeof value !== "number"
	) {
		return value;
	}
	const { trimStart, trimEnd } = expectedManifestTrims({ expected });
	return Math.max(0, value - trimStart - trimEnd);
}

function actualReadBackValue({
	actual,
	expected,
	key,
}: {
	actual: JsonRecord;
	expected: ManifestElement;
	key: string;
}): unknown {
	if (key === "textAnimationPreset") {
		const request = expected.textAnimationPreset;
		if (!isRecord(request)) return;
		const phase = stringValue(request, "phase");
		if (!phase) return;
		const animations = actual.textAnimations;
		if (!isRecord(animations)) return;
		const phaseState = animations[phase];
		if (!isRecord(phaseState)) {
			return stringValue(request, "presetId") === "none" ? "none" : undefined;
		}
		const sourcePreset = phaseState.sourcePreset;
		return isRecord(sourcePreset) ? stringValue(sourcePreset, "id") : undefined;
	}
	return actual[key] ?? (actual.style as JsonRecord | undefined)?.[key];
}

export function verifyManifest({
	timeline,
	manifest,
	trackIds,
	elementIds,
	expectedElements,
	transitionIds,
	positional = true,
}: {
	timeline: TimelineSnapshot;
	manifest: TimelineManifest;
	trackIds: Map<string, string>;
	elementIds: Map<string, string>;
	expectedElements: Map<string, ManifestElement>;
	transitionIds: string[];
	/** Array order set the track order (a whole-timeline manifest). */
	positional?: boolean;
}): string[] {
	const issues: string[] = [];
	for (const [arrayIndex, track] of (manifest.tracks ?? []).entries()) {
		const alias = aliasFor(track, `track-${arrayIndex}`);
		const id = trackIds.get(alias);
		const actualIndex = timeline.tracks.findIndex(
			(candidate) => candidate.id === id
		);
		if (actualIndex < 0) {
			issues.push(`track '${alias}' is missing`);
			continue;
		}
		const expectedIndex = positional
			? arrayIndex
			: typeof track.index === "number"
				? track.index
				: undefined;
		if (expectedIndex !== undefined && actualIndex !== expectedIndex) {
			issues.push(
				`track '${alias}' expected index ${expectedIndex}, got ${actualIndex}`
			);
		}
		const actual = timeline.tracks[actualIndex];
		if (actual.type !== track.type) {
			issues.push(`track '${alias}' type mismatch`);
		}
		if (track.name !== undefined && actual.name !== track.name) {
			issues.push(`track '${alias}' name mismatch`);
		}
		if (
			track.colorLabel !== undefined &&
			(actual.colorLabel ?? null) !== (track.colorLabel || null)
		) {
			issues.push(`track '${alias}' colorLabel did not match`);
		}
		for (const key of ["muted", "hidden", "locked"] as const) {
			if (
				typeof track[key] === "boolean" &&
				(actual[key] === true) !== track[key]
			) {
				issues.push(`track '${alias}' ${key} did not match`);
			}
		}
	}

	const actualElements = new Map(
		timeline.tracks.flatMap((track) =>
			track.elements.map((element) => [element.id, element])
		)
	);
	for (const [alias, expected] of expectedElements) {
		const id = elementIds.get(alias);
		const actual = id ? actualElements.get(id) : undefined;
		if (!actual) {
			issues.push(`element '${alias}' is missing`);
			continue;
		}
		const verifiesText =
			expected.type === "text" || expected.type === "captions";
		const verifiesMedia =
			expected.type === "media" ||
			expected.type === "video" ||
			expected.type === "audio" ||
			expected.type === "image";
		// `endTime` is where the clip ends on the timeline whatever its trims
		// and speed, so a length that went wrong on the way in shows up here
		// even when the trimmed `duration` happens to read back consistently.
		const verificationKeys = [
			"startTime",
			"endTime",
			"duration",
			"trimStart",
			"trimEnd",
			...(verifiesText ? TEXT_VERIFY_KEYS : []),
			...(verifiesMedia ? MEDIA_VERIFY_KEYS : []),
			...(expected.type === "sticker" ? STICKER_VERIFY_KEYS : []),
			...(expected.type === "adjustment" ? ADJUSTMENT_VERIFY_KEYS : []),
		] as const;
		for (const key of verificationKeys) {
			const expectedValue = expectedReadBackValue({ expected, key });
			if (expectedValue === undefined) continue;
			const actualValue = actualReadBackValue({
				actual,
				expected,
				key,
			});
			if (!valuesMatch(expectedValue, actualValue)) {
				issues.push(`element '${alias}' field '${key}' did not match`);
			}
		}
	}

	const actualTransitions = new Map(
		timeline.tracks.flatMap((track) =>
			(track.transitions ?? []).flatMap((transition) =>
				transition.id
					? [[transition.id, { trackId: track.id, transition }]]
					: []
			)
		)
	);
	const expectedTransitions = collectTransitions(manifest);
	for (const [index, transitionId] of transitionIds.entries()) {
		const expected = expectedTransitions[index];
		const actual = actualTransitions.get(transitionId);
		if (!(expected && actual)) {
			issues.push(`transition '${transitionId}' is missing`);
			continue;
		}
		const expectedTrackId = mapReference(
			trackIds,
			expected.track ?? expected.trackId
		);
		const expectedFromId = mapReference(
			elementIds,
			expected.from ?? expected.fromElementId
		);
		const expectedToId = mapReference(
			elementIds,
			expected.to ?? expected.toElementId
		);
		if (expectedTrackId && actual.trackId !== expectedTrackId) {
			issues.push(`transition '${transitionId}' track did not match`);
		}
		if (expectedFromId && actual.transition.fromElementId !== expectedFromId) {
			issues.push(`transition '${transitionId}' from element did not match`);
		}
		if (expectedToId && actual.transition.toElementId !== expectedToId) {
			issues.push(`transition '${transitionId}' to element did not match`);
		}
		for (const key of TRANSITION_VERIFY_KEYS) {
			const expectedValue =
				key === "presetId"
					? (expected.presetId ?? expected.type)
					: expected[key];
			if (expectedValue === undefined) continue;
			if (!valuesMatch(expectedValue, actual.transition[key])) {
				issues.push(
					`transition '${transitionId}' field '${key}' did not match`
				);
			}
		}
	}
	return issues;
}

/** Apply one declarative timeline manifest with rollback and read-back verification. */
