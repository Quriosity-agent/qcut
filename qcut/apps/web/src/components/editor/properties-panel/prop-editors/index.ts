/**
 * Prop Editors for Remotion Component Properties
 *
 * These components render appropriate input controls based on the prop type
 * parsed from Zod schemas.
 *
 * @module components/editor/properties-panel/prop-editors
 */

export { TextProp, type TextPropProps } from "./text-prop";
export { NumberProp, type NumberPropProps } from "./number-prop";
export { ColorProp, type ColorPropProps } from "./color-prop";
export { SelectProp, type SelectPropProps } from "./select-prop";
export { BooleanProp, type BooleanPropProps } from "./boolean-prop";
export { PropEditorFactory } from "./prop-editor-factory";
export { KeyframeEditor, type KeyframeEditorProps } from "../keyframe-editor";
export type { BasePropEditorProps } from "./types";
