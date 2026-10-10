import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function PortraitCollapsibleGroup({
	active,
	children,
	label,
	onOpenChange,
	open,
	testId,
}: {
	active: boolean;
	children: ReactNode;
	label: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	testId: string;
}) {
	return (
		<Collapsible
			open={open}
			onOpenChange={onOpenChange}
			className="border-b border-border/70"
			data-active={active}
			data-testid={testId}
		>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="flex h-10 w-full items-center gap-2 px-0.5 text-left text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<span
						className={cn(
							"size-1.5 shrink-0 rounded-full transition-colors",
							active ? "bg-cyan-500" : "bg-muted-foreground/40"
						)}
						aria-hidden="true"
					/>
					<span>{label}</span>
					<ChevronDown
						className={cn(
							"size-3 text-muted-foreground transition-transform",
							!open && "-rotate-90"
						)}
					/>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
				<div className="pb-3 pt-1">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
