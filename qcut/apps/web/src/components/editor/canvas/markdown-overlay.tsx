import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownElement } from "@/types/timeline";

interface MarkdownOverlayProps {
  element: MarkdownElement;
  currentTime: number;
  canvasScale: number;
}

const THEME_STYLE_MAP = {
  light: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    textColor: "#111827",
  },
  dark: {
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    textColor: "#f9fafb",
  },
  transparent: {
    backgroundColor: "transparent",
    textColor: "#f9fafb",
  },
} as const;

function getThemeStyles({ element }: { element: MarkdownElement }) {
  const themeStyles = THEME_STYLE_MAP[element.theme] ?? THEME_STYLE_MAP.dark;
  return {
    backgroundColor: element.backgroundColor || themeStyles.backgroundColor,
    textColor: element.textColor || themeStyles.textColor,
  };
}

export function MarkdownOverlay({
  element,
  currentTime,
  canvasScale,
}: MarkdownOverlayProps) {
  const scrollOffset = useMemo(() => {
    try {
      if (element.scrollMode !== "auto-scroll") {
        return 0;
      }

      const elapsed = Math.max(0, currentTime - element.startTime);
      return elapsed * Math.max(0, element.scrollSpeed);
    } catch (error) {
      console.error(
        "[MarkdownOverlay] Failed to calculate scroll offset:",
        error
      );
      return 0;
    }
  }, [element.scrollMode, element.startTime, element.scrollSpeed, currentTime]);

  const { backgroundColor, textColor } = getThemeStyles({ element });

  return (
    <div
      className="h-full w-full overflow-hidden rounded-sm border border-white/10"
      style={{
        backgroundColor,
        color: textColor,
        fontSize: `${element.fontSize}px`,
        fontFamily: element.fontFamily,
        padding: `${element.padding * canvasScale}px`,
        boxSizing: "border-box",
      }}
      data-testid="markdown-overlay"
    >
      <div
        style={{
          transform: `translateY(-${scrollOffset * canvasScale}px)`,
          willChange:
            element.scrollMode === "auto-scroll" ? "transform" : "auto",
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-2xl font-semibold mb-3 leading-tight">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-xl font-semibold mb-2 leading-tight">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-lg font-semibold mb-2 leading-tight">
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p className="mb-2 leading-relaxed">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="list-disc ml-5 mb-3 space-y-1">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal ml-5 mb-3 space-y-1">{children}</ol>
            ),
            code: ({ children }) => (
              <code className="font-mono bg-black/20 px-1 py-0.5 rounded">
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="font-mono text-xs bg-black/20 p-2 rounded mb-3 overflow-x-auto">
                {children}
              </pre>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-current/30 pl-3 italic mb-2 opacity-80">
                {children}
              </blockquote>
            ),
            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-current/50"
              >
                {children}
              </a>
            ),
            table: ({ children }) => (
              <table className="w-full text-left border-collapse mb-3">
                {children}
              </table>
            ),
            th: ({ children }) => (
              <th className="border border-current/30 px-2 py-1 text-xs font-semibold">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-current/20 px-2 py-1 text-xs">
                {children}
              </td>
            ),
          }}
        >
          {element.markdownContent || ""}
        </ReactMarkdown>
      </div>
    </div>
  );
}
