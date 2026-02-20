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

// Common prop editor interface
export interface BasePropEditorProps<T> {
	/** Field name (used for form binding) */
	name: string;
	/** Display label */
	label: string;
	/** Current value */
	value: T;
	/** Change handler */
	onChange: (value: T) => void;
	/** Optional description/help text */
	description?: string;
	/** Validation error message */
	error?: string;
	/** Whether the field is disabled */
	disabled?: boolean;
}
