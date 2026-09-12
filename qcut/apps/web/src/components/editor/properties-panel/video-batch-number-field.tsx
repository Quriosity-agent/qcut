import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export function VideoBatchNumberField({
	label,
	value,
	mixed,
	mixedLabel,
	suffix,
	disabled,
	onCommit,
}: {
	label: string;
	value: number;
	mixed: boolean;
	mixedLabel: string;
	suffix: string;
	disabled: boolean;
	onCommit: (value: number) => void;
}) {
	const id = useId();
	const initialValue = mixed ? "" : String(Number(value.toFixed(4)));
	const [draft, setDraft] = useState(initialValue);
	const changed = useRef(false);
	const commit = () => {
		if (!changed.current || disabled) return;
		changed.current = false;
		const parsed = Number(draft);
		if (draft.trim() && Number.isFinite(parsed)) onCommit(parsed);
		setDraft(initialValue);
	};

	return (
		<div className="flex min-w-0 items-center justify-between gap-3">
			<label htmlFor={id} className="min-w-0 text-xs">
				{label}
			</label>
			<div className="flex w-32 shrink-0 items-center gap-1">
				<Input
					id={id}
					type="number"
					step="any"
					className="h-8 min-w-0 text-xs"
					value={draft}
					placeholder={mixed ? mixedLabel : undefined}
					disabled={disabled}
					onChange={(event) => {
						changed.current = true;
						setDraft(event.target.value);
					}}
					onBlur={commit}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
							event.currentTarget.blur();
						}
						if (event.key === "Escape") {
							changed.current = false;
							setDraft(initialValue);
							event.currentTarget.blur();
						}
					}}
				/>
				<span className="w-5 shrink-0 text-xs text-muted-foreground">
					{suffix}
				</span>
			</div>
		</div>
	);
}
