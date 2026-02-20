/**
 * Select Prop Editor
 *
 * Dropdown component for properties with predefined options.
 *
 * @module components/editor/properties-panel/prop-editors/select-prop
 */

import React, { useCallback } from "react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BasePropEditorProps } from "./index";

export interface SelectOption {
	label: string;
	value: unknown;
}

export interface SelectPropProps extends BasePropEditorProps<unknown> {
	/** Available options */
	options: SelectOption[];
	/** Placeholder text when no value selected */
	placeholder?: string;
}

export function SelectProp({
	name,
	label,
	value,
	onChange,
	description,
	error,
	disabled,
	options,
	placeholder = "Select...",
}: SelectPropProps) {
	// Convert value to string for Select component
	const stringValue =
		value !== undefined && value !== null ? String(value) : "";

	const handleChange = useCallback(
		(newStringValue: string) => {
			// Find the original value from options
			const option = options.find(
				(opt) => String(opt.value) === newStringValue
			);
			if (option) {
				onChange(option.value);
			}
		},
		[options, onChange]
	);

	return (
		<div className="space-y-1.5">
			<Label htmlFor={name} className={cn("text-xs", error && "text-red-500")}>
				{label}
			</Label>

			<Select
				value={stringValue}
				onValueChange={handleChange}
				disabled={disabled}
			>
				<SelectTrigger
					id={name}
					className={cn(
						"h-8 text-sm",
						error && "border-red-500 focus:ring-red-500"
					)}
				>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option, index) => (
						<SelectItem
							key={`${String(option.value)}-${index}`}
							value={String(option.value)}
							className="text-sm"
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{description && !error && (
				<p className="text-[10px] text-muted-foreground">{description}</p>
			)}

			{error && <p className="text-[10px] text-red-500">{error}</p>}
		</div>
	);
}
