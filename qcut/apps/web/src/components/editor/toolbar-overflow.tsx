import type { ReactNode } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

export function ToolbarOverflow({
	compact,
	label,
	testId,
	children,
	icon: Icon = Ellipsis,
}: {
	compact: boolean;
	label: string;
	testId: string;
	children: ReactNode;
	icon?: LucideIcon;
}) {
	if (!compact) {
		return <div className="flex items-center gap-1">{children}</div>;
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="text"
					size="icon"
					title={label}
					aria-label={label}
					data-testid={testId}
				>
					<Icon className="size-4">
						<title>{label}</title>
					</Icon>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				aria-label={label}
				data-testid={`${testId}-content`}
				className="w-80 max-w-[calc(100vw-2rem)] p-3"
			>
				<p className="mb-2 text-xs text-muted-foreground">{label}</p>
				<div className="flex flex-wrap items-center gap-2">{children}</div>
			</PopoverContent>
		</Popover>
	);
}
