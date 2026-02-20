import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";

// Custom render function that includes all necessary providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			enableSystem={false}
			forcedTheme="dark"
		>
			<TooltipProvider>{children}</TooltipProvider>
		</ThemeProvider>
	);
};

const customRender = (
	ui: React.ReactElement,
	options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from "@testing-library/react";
export { customRender as render };
