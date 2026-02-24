/**
 * Text Prop Editor
 *
 * Input component for string properties with optional multiline support.
 *
 * @module components/editor/properties-panel/prop-editors/text-prop
 */

import React, { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BasePropEditorProps } from "./types";

export interface TextPropProps extends BasePropEditorProps<string> {
	/** Whether to use multiline textarea */
	multiline?: boolean;
	/** Minimum length */
	minLength?: number;
	/** Maximum length */
	maxLength?: number;
	/** Placeholder text */
	placeholder?: string;
	/** Pattern for validation */
	pattern?: string;
}

export function TextProp({
	name,
	label,
	value,
	onChange,
	description,
	error,
	disabled,
	multiline = false,
	minLength,
	maxLength,
	placeholder,
}: TextPropProps) {
	const [localValue, setLocalValue] = useState(value);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			setLocalValue(newValue);
			onChange(newValue);
		},
		[onChange]
	);

	const handleBlur = useCallback(() => {
		// Sync on blur in case of any discrepancy
		if (localValue !== value) {
			setLocalValue(value);
		}
	}, [localValue, value]);

	// Sync local state with external value changes
	React.useEffect(() => {
		setLocalValue(value);
	}, [value]);

	const showCharCount = maxLength !== undefined;
	const charCount = localValue?.length ?? 0;
	const isOverLimit = maxLength !== undefined && charCount > maxLength;

	const inputClasses = cn(
		"h-8 text-sm",
		error && "border-red-500 focus-visible:ring-red-500",
		isOverLimit && "border-yellow-500"
	);

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between">
				<Label
					htmlFor={name}
					className={cn("text-xs", error && "text-red-500")}
				>
					{label}
				</Label>
				{showCharCount && (
					<span
						className={cn(
							"text-[10px] text-muted-foreground",
							isOverLimit && "text-yellow-500"
						)}
					>
						{charCount}/{maxLength}
					</span>
				)}
			</div>

			{multiline ? (
				<Textarea
					id={name}
					name={name}
					value={localValue}
					onChange={handleChange}
					onBlur={handleBlur}
					disabled={disabled}
					placeholder={placeholder}
					minLength={minLength}
					maxLength={maxLength ? maxLength + 10 : undefined} // Allow slight overflow for UX
					className={cn(inputClasses, "min-h-[80px] resize-y")}
					rows={3}
				/>
			) : (
				<Input
					id={name}
					name={name}
					type="text"
					value={localValue}
					onChange={handleChange}
					onBlur={handleBlur}
					disabled={disabled}
					placeholder={placeholder}
					minLength={minLength}
					maxLength={maxLength ? maxLength + 10 : undefined}
					className={inputClasses}
				/>
			)}

			{description && !error && (
				<p className="text-[10px] text-muted-foreground">{description}</p>
			)}

			{error && <p className="text-[10px] text-red-500">{error}</p>}
		</div>
	);
}
