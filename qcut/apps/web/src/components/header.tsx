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
        <Link
          to="/blog"
          className="text-sm p-0 text-slate-400 hover:text-cyan-400 transition-colors"
        >
          Blog
        </Link>
        <Link
          to="/contributors"
          className="text-sm p-0 text-slate-400 hover:text-cyan-400 transition-colors"
        >
          Contributors
        </Link>
      </div>
      <Link to="/projects">
        <Button size="sm" className="text-sm ml-4 bg-cyan-500 hover:bg-cyan-400 text-gray-950 shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] transition-all duration-300">
          Projects
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </nav>
  );

  return (
    <div className="mx-4 md:mx-0">
      <HeaderBase
        className="bg-gray-950/80 backdrop-blur-md border border-slate-800 rounded-2xl max-w-3xl mx-auto mt-4 pl-4 pr-[14px] shadow-[0_0_15px_rgba(6,182,212,0.1)]"
        leftContent={leftContent}
        rightContent={rightContent}
      />
    </div>
  );
}
