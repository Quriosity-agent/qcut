/**
 * Shared types for prop editor components.
 *
 * @module components/editor/properties-panel/prop-editors/types
 */

/** Common prop editor interface */
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
