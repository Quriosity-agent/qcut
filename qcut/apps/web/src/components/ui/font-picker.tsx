import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { FONT_OPTIONS } from "@/constants/font-constants";

interface FontPickerProps {
	/** Forwarded to the trigger so a visible `<Label htmlFor>` can name it. */
	id?: string;
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	className?: string;
	customOption?: { value: string; label: string };
}

export function FontPicker({
	id,
	value,
	defaultValue,
	onValueChange,
	className,
	customOption,
}: FontPickerProps) {
	const hasBuiltInValue = FONT_OPTIONS.some((font) => font.value === value);
	return (
		<Select
			value={value}
			defaultValue={value === undefined ? defaultValue : undefined}
			onValueChange={onValueChange}
		>
			<SelectTrigger id={id} className={`w-full text-xs ${className || ""}`}>
				<SelectValue placeholder="Select a font" />
			</SelectTrigger>
			<SelectContent>
				{customOption && !hasBuiltInValue ? (
					<SelectItem
						value={customOption.value}
						className="text-xs"
						style={{ fontFamily: customOption.value }}
					>
						{customOption.label}
					</SelectItem>
				) : null}
				{FONT_OPTIONS.map((font) => (
					<SelectItem
						key={font.value}
						value={font.value}
						className="text-xs"
						style={{ fontFamily: font.value }}
					>
						{font.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
