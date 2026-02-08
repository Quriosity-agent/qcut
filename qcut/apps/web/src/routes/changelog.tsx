import React, { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { fetchChangelog } from "@/lib/release-notes";
import type { ReleaseNote } from "@/types/electron";

export const Route = createFileRoute("/changelog")({
  component: ChangelogPage,
});

function ChannelBadge({ channel }: { channel: string }) {
  const colors: Record<string, string> = {
    stable: "bg-green-500/10 text-green-500",
    alpha: "bg-red-500/10 text-red-500",
    beta: "bg-yellow-500/10 text-yellow-500",
    rc: "bg-blue-500/10 text-blue-500",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[channel] || colors.stable}`}
    >
      {channel}
    </span>
  );
}

function MarkdownContent({ content }: { content: string }) {
  // Simple Markdown renderer for release notes:
  // handles headings (## / ###), bullet lists (- / *), and paragraphs
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    elements.push(
      <ul
        key={`list-${elements.length}`}
        className="list-disc list-inside space-y-1 text-sm text-muted-foreground"
      >
        {listItems.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("# ")) {
      flushList();
      // Skip top-level heading (already shown in version header)
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h3
          key={`h-${elements.length}`}
          className="text-base font-semibold mt-4 mb-2"
        >
          {trimmed.replace(/^##\s+/, "")}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h4
          key={`h4-${elements.length}`}
          className="text-sm font-semibold mt-3 mb-1"
        >
          {trimmed.replace(/^###\s+/, "")}
        </h4>
      );
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (trimmed === "") {
      flushList();
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${elements.length}`} className="text-sm text-muted-foreground">
        {trimmed}
      </p>
    );
  }

  flushList();

  return <div className="space-y-1">{elements}</div>;
}

function ReleaseEntry({
  note,
  defaultOpen,
}: {
  note: ReleaseNote;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">v{note.version}</h2>
          <ChannelBadge channel={note.channel} />
          {note.date && (
            <span className="text-sm text-muted-foreground">{note.date}</span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <title>Toggle</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <MarkdownContent content={note.content} />
        </div>
      )}
    </div>
  );
}

function ChangelogPage() {
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fetchChangelog();
      if (!cancelled) {
        setNotes(data);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">
            Changelog
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            Release history and what changed in each version.
          </p>

          {loading && (
            <div className="text-muted-foreground">Loading changelog...</div>
          )}

          {!loading && notes.length === 0 && (
            <div className="text-muted-foreground">
              No release notes available. Check the{" "}
              <a
                href="https://github.com/donghaozhang/qcut/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                GitHub releases
              </a>{" "}
              page.
            </div>
          )}

          <div className="space-y-3">
            {notes.map((note, i) => (
              <ReleaseEntry
                key={note.version}
                note={note}
                defaultOpen={i === 0}
              />
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
