/**
 * CollapsibleSection — reusable collapsible section for property panels.
 * Compact header with chevron toggle.
 */

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
	title,
	icon: Icon,
	defaultOpen = false,
	children,
	className,
}: {
	title: string;
	icon?: React.ElementType;
	defaultOpen?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div className={cn("border-t pt-1.5", className)}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1 w-full text-left py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
			>
				{open ? (
					<ChevronDownIcon className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRightIcon className="h-3 w-3 shrink-0" />
				)}
				{Icon && <Icon className="h-3 w-3 shrink-0" />}
				{title}
			</button>
			{open && <div className="space-y-1.5 pt-1">{children}</div>}
		</div>
	);
}
