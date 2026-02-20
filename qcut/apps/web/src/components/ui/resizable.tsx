"use client";

import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "../../lib/utils";

/**
 * react-resizable-panels v4 wrapper components.
 *
 * v4 changes vs v2:
 * - Group sets display/flexDirection/overflow via inline styles (no CSS class needed)
 * - No more data-panel-group-direction attribute; use aria-orientation on Separator
 * - Separator aria-orientation is perpendicular to the group:
 *   horizontal group → aria-orientation="vertical" (vertical divider line)
 *   vertical group   → aria-orientation="horizontal" (horizontal divider line)
 */

const ResizablePanelGroup = ({
	className,
	...props
}: React.ComponentProps<typeof Group>) => (
	<Group className={cn("h-full w-full", className)} {...props} />
);

const ResizablePanel = Panel;

// Default styles for a vertical separator line (inside a horizontal group)
const baseHandleClasses =
	"relative flex w-px items-center justify-center bg-transparent " +
	"after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 " +
	"focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1";

// Override for a horizontal separator line (inside a vertical group)
// v4 uses aria-orientation="horizontal" on separators in vertical groups
const verticalGroupClasses =
	"aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full " +
	"aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 " +
	"aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2 " +
	"aria-[orientation=horizontal]:after:translate-x-0";

const ResizableHandle = ({
	withHandle,
	className,
	...props
}: React.ComponentProps<typeof Separator> & {
	withHandle?: boolean;
}) => (
	<Separator
		className={cn(baseHandleClasses, verticalGroupClasses, className)}
		{...props}
	/>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
