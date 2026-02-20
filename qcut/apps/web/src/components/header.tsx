"use client";

import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { ArrowRight } from "lucide-react";
import { HeaderBase } from "./header-base";
import { ThemeToggle } from "./ui/theme-toggle";
import { getAssetPath } from "@/lib/asset-path";

export function Header() {
	const leftContent = (
		<Link to="/" className="flex items-center gap-3">
			<img
				src={getAssetPath("assets/logo-v4.png")}
				alt="QCut Logo"
				className="h-8 w-8"
			/>
			<span className="text-xl font-medium hidden md:block">QCut</span>
		</Link>
	);

	const rightContent = (
		<nav className="flex items-center gap-1">
			<ThemeToggle />
			<div className="flex items-center gap-4 ml-2">
				<a
					href="https://quriosity.com.au/"
					className="text-sm p-0 text-muted-foreground hover:text-foreground transition-colors"
					target="_blank"
					rel="noopener noreferrer"
				>
					Blog
				</a>
			</div>
			<Link to="/projects">
				<Button size="sm" className="text-sm ml-4">
					Projects
					<ArrowRight className="h-4 w-4" />
				</Button>
			</Link>
		</nav>
	);

	return (
		<div className="mx-4 md:mx-0">
			<HeaderBase
				className="bg-background border rounded-2xl max-w-3xl mx-auto mt-4 pl-4 pr-[14px]"
				leftContent={leftContent}
				rightContent={rightContent}
			/>
		</div>
	);
}
