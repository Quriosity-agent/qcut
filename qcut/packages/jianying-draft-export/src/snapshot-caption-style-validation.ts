/**
 * A caption's stored style in a timeline snapshot, checked field by field:
 * unknown properties and wrong types are refused before a draft is written.
 * Moved out of snapshot-element-runtime-validation.ts with the film-subtitle
 * fields (N25: weight, soft shadows, fade frames, the second line's
 * spacing and weight).
 *
 * @module jianying-draft-export/snapshot-caption-style-validation
 */

import type {
	CaptionSecondaryStyle,
	CaptionShadow,
	SubtitleStyle,
} from "@qcut/editor-core";
import {
	assertNoUnknownKeys,
	assertOptionalBoolean,
	assertOptionalFiniteNumber,
	assertStringLiteral,
	getArray,
	getBoolean,
	getFiniteNumber,
	getRecord,
	getString,
	type JsonValue,
	validationIssue,
} from "./runtime-json.js";
import { createAllowedKeySet } from "./snapshot-runtime-helpers.js";

const SUBTITLE_STYLE_KEYS = createAllowedKeySet<SubtitleStyle>({
	keys: {
		animationDelay: true,
		animationDuration: true,
		animationType: true,
		backgroundColor: true,
		bgOpacity: true,
		bold: true,
		fadeInFrames: true,
		fadeOutFrames: true,
		fontColor: true,
		fontFamily: true,
		fontOpacity: true,
		fontSize: true,
		fontWeight: true,
		highlightColor: true,
		highlightScale: true,
		italic: true,
		karaokeMode: true,
		letterSpacing: true,
		lineSpacing: true,
		outlineColor: true,
		outlineWidth: true,
		position: true,
		secondary: true,
		shadowColor: true,
		shadowOffset: true,
		shadows: true,
		textAlign: true,
		underline: true,
		upcomingColor: true,
	},
});
const SUBTITLE_SECONDARY_KEYS = createAllowedKeySet<CaptionSecondaryStyle>({
	keys: {
		bold: true,
		fontColor: true,
		fontFamily: true,
		fontSize: true,
		fontWeight: true,
		italic: true,
		letterSpacing: true,
	},
});
const SUBTITLE_SHADOW_KEYS = createAllowedKeySet<CaptionShadow>({
	keys: { blur: true, color: true, opacity: true, x: true, y: true },
});
const SUBTITLE_SHADOW_OFFSET_KEYS = new Set(["x", "y"]);
const SUBTITLE_POSITION_KEYS = new Set(["align", "x", "y"]);

/** A number in [min, max] (a whole one when `integer`), or undefined if allowed. */
function assertNumberInRange({
	path,
	value,
	min,
	max,
	integer = false,
	optional = false,
}: {
	path: string;
	value: JsonValue | undefined;
	min: number;
	max: number;
	integer?: boolean;
	optional?: boolean;
}): void {
	if (value === undefined && optional) return;
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max &&
		(!integer || Number.isInteger(value))
	) {
		return;
	}
	throw validationIssue({
		message: `Expected ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`,
		path,
	});
}

function validateSubtitleShadows({
	path,
	value,
}: {
	path: string;
	value: JsonValue;
}): void {
	for (const [index, entry] of getArray({ path, value }).entries()) {
		const shadowPath = `${path}[${index}]`;
		const shadow = getRecord({ path: shadowPath, value: entry });
		assertNoUnknownKeys({
			allowed: SUBTITLE_SHADOW_KEYS,
			path: shadowPath,
			record: shadow,
		});
		// The editor stores every field of a shadow.
		getString({ path: `${shadowPath}.color`, value: shadow.color });
		assertNumberInRange({
			path: `${shadowPath}.opacity`,
			value: shadow.opacity,
			min: 0,
			max: 1,
		});
		assertNumberInRange({
			path: `${shadowPath}.blur`,
			value: shadow.blur,
			min: 0,
			max: 200,
		});
		for (const key of ["x", "y"]) {
			getFiniteNumber({ path: `${shadowPath}.${key}`, value: shadow[key] });
		}
	}
}

export function validateSubtitleStyle({
	path: stylePath,
	value,
}: {
	path: string;
	value: JsonValue;
}): void {
	const style = getRecord({ path: stylePath, value });
	assertNoUnknownKeys({
		allowed: SUBTITLE_STYLE_KEYS,
		path: stylePath,
		record: style,
	});
	for (const key of [
		"fontFamily",
		"fontColor",
		"outlineColor",
		"shadowColor",
		"backgroundColor",
	]) {
		getString({
			allowEmpty: true,
			path: `${stylePath}.${key}`,
			value: style[key],
		});
	}
	assertStringLiteral({
		allowed: new Set(["left", "center", "right"]),
		path: `${stylePath}.textAlign`,
		value: style.textAlign,
	});
	assertStringLiteral({
		allowed: new Set(["none", "fade", "slide-up", "slide-left"]),
		path: `${stylePath}.animationType`,
		value: style.animationType,
	});
	for (const key of [
		"fontSize",
		"letterSpacing",
		"fontOpacity",
		"outlineWidth",
		"bgOpacity",
		"lineSpacing",
		"animationDuration",
		"animationDelay",
	]) {
		getFiniteNumber({
			path: `${stylePath}.${key}`,
			value: style[key],
		});
	}
	for (const key of ["bold", "italic", "underline"]) {
		getBoolean({
			path: `${stylePath}.${key}`,
			value: style[key],
		});
	}
	// Film-subtitle fields (N25), absent on older captions; the same ranges
	// the editor API accepts.
	assertNumberInRange({
		path: `${stylePath}.fontWeight`,
		value: style.fontWeight,
		min: 100,
		max: 900,
		optional: true,
	});
	for (const key of ["fadeInFrames", "fadeOutFrames"]) {
		assertNumberInRange({
			path: `${stylePath}.${key}`,
			value: style[key],
			min: 0,
			max: 600,
			integer: true,
			optional: true,
		});
	}
	if (style.shadows !== undefined) {
		validateSubtitleShadows({
			path: `${stylePath}.shadows`,
			value: style.shadows,
		});
	}
	const shadowPath = `${stylePath}.shadowOffset`;
	const shadow = getRecord({
		path: shadowPath,
		value: style.shadowOffset,
	});
	assertNoUnknownKeys({
		allowed: SUBTITLE_SHADOW_OFFSET_KEYS,
		path: shadowPath,
		record: shadow,
	});
	const positionPath = `${stylePath}.position`;
	const position = getRecord({
		path: positionPath,
		value: style.position,
	});
	assertNoUnknownKeys({
		allowed: SUBTITLE_POSITION_KEYS,
		path: positionPath,
		record: position,
	});
	assertStringLiteral({
		allowed: new Set(["top", "center", "bottom"]),
		path: `${positionPath}.align`,
		value: position.align,
	});
	if (style.secondary !== undefined) {
		const secondaryPath = `${stylePath}.secondary`;
		const secondary = getRecord({
			path: secondaryPath,
			value: style.secondary,
		});
		assertNoUnknownKeys({
			allowed: SUBTITLE_SECONDARY_KEYS,
			path: secondaryPath,
			record: secondary,
		});
		for (const key of ["fontFamily", "fontColor"]) {
			if (secondary[key] !== undefined) {
				getString({ path: `${secondaryPath}.${key}`, value: secondary[key] });
			}
		}
		for (const key of ["fontSize", "letterSpacing"]) {
			assertOptionalFiniteNumber({
				path: `${secondaryPath}.${key}`,
				value: secondary[key],
			});
		}
		assertNumberInRange({
			path: `${secondaryPath}.fontWeight`,
			value: secondary.fontWeight,
			min: 100,
			max: 900,
			optional: true,
		});
		for (const key of ["bold", "italic"]) {
			assertOptionalBoolean({
				path: `${secondaryPath}.${key}`,
				value: secondary[key],
			});
		}
	}
}
