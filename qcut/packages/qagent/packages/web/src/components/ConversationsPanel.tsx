"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	LeadConversationMessage,
	LeadConversationSnapshot,
} from "@/lib/conversations";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_LIMIT = 40;
const RAW_PREVIEW_LIMIT = 420;

interface ConversationItem extends LeadConversationMessage {
	displayText: string;
	repeatCount: number;
}

function formatTimestamp({
	iso,
}: {
	iso: string | null;
}): string {
	if (!iso) return "unknown";
	const value = new Date(iso);
	if (Number.isNaN(value.getTime())) return iso;
	return value.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function summarizeText({
	text,
}: {
	text: string;
}): string {
	const compact = text.trim();
	if (compact.length === 0) return "(empty)";
	if (compact.length <= RAW_PREVIEW_LIMIT) return compact;
	return `${compact.slice(0, RAW_PREVIEW_LIMIT)}…`;
}

function isNoiseLine({
	line,
}: {
	line: string;
}): boolean {
	if (line.startsWith("[qagent-")) return true;
	if (line.startsWith("[truncated")) return true;
	if (line.startsWith("timestamp=")) return true;
	if (line.includes("summary=relay:")) return true;
	if (line.includes("session=agent:")) return true;
	if (line.includes("gpt-5.3-codex")) return true;
	if (line === "…" || line === "...") return true;
	if (line.startsWith("↳")) return true;
	return false;
}

function extractMeaningfulText({
	text,
}: {
	text: string;
}): string {
	try {
		const lines = text
			.replace(/\r/g, "")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		const promptLines = lines
			.filter((line) => line.startsWith("›"))
			.map((line) => line.replace(/^›\s*/, "").trim())
			.filter((line) => line.length > 0);

		if (promptLines.length > 0) {
			return promptLines.join(" | ");
		}

		const meaningfulLines = lines.filter((line) => !isNoiseLine({ line }));
		if (meaningfulLines.length > 0) {
			const joined = meaningfulLines.slice(0, 4).join(" | ");
			return summarizeText({ text: joined });
		}

		return summarizeText({ text });
	} catch {
		return summarizeText({ text });
	}
}

function toErrorMessage({
	error,
}: {
	error: unknown;
}): string {
	if (error instanceof Error) return error.message;
	return "Failed to fetch conversations";
}

export function ConversationsPanel() {
	const [snapshot, setSnapshot] = useState<LeadConversationSnapshot | null>(
		null,
	);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [showRaw, setShowRaw] = useState(false);

	const fetchSnapshot = useCallback(async (): Promise<void> => {
		try {
			const response = await fetch(
				`/api/conversations/lead?limit=${DEFAULT_LIMIT}`,
				{
					cache: "no-store",
				},
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as {
					error?: string;
				};
				throw new Error(body.error ?? `HTTP ${response.status}`);
			}
			const payload = (await response.json()) as LeadConversationSnapshot;
			setSnapshot(payload);
			setErrorMessage(null);
		} catch (error) {
			setErrorMessage(toErrorMessage({ error }));
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		let active = true;
		const runFetch = async (): Promise<void> => {
			if (!active) return;
			await fetchSnapshot();
		};
		void runFetch();
		const timer = setInterval(() => {
			void runFetch();
		}, POLL_INTERVAL_MS);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [fetchSnapshot]);

	const messages = useMemo<ConversationItem[]>(() => {
		if (!snapshot) return [];
		const normalized = snapshot.messages.map((message) => ({
			...message,
			displayText: showRaw
				? summarizeText({ text: message.text })
				: extractMeaningfulText({ text: message.text }),
			repeatCount: 1,
		}));
		const collapsed: ConversationItem[] = [];
		for (const message of normalized) {
			const previous = collapsed[collapsed.length - 1];
			if (
				previous &&
				previous.from === message.from &&
				previous.displayText === message.displayText
			) {
				previous.repeatCount += 1;
				previous.timestamp = message.timestamp;
				continue;
			}
			collapsed.push(message);
		}
		return collapsed;
	}, [showRaw, snapshot]);

	return (
		<div className="mb-8 rounded-[8px] border border-[var(--color-border-subtle)] bg-[rgba(56,189,248,0.04)]">
			<button
				type="button"
				onClick={() => setIsCollapsed((prev) => !prev)}
				className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[rgba(255,255,255,0.02)]"
			>
				<div>
					<h2 className="text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--color-text-tertiary)]">
						Conversations
					</h2>
					<p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
						Live tail of <code>lead.json</code>
					</p>
				</div>
				<div className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
					<label className="flex items-center gap-1 rounded-[4px] border border-[var(--color-border-subtle)] px-2 py-0.5">
						<input
							type="checkbox"
							checked={showRaw}
							onChange={(event) => setShowRaw(event.target.checked)}
							className="h-3 w-3 accent-[var(--color-accent)]"
							aria-label="show raw relay payload"
						/>
						raw
					</label>
					<span className="rounded-[4px] border border-[var(--color-border-subtle)] px-2 py-0.5">
						{snapshot?.teamId ?? "no team"}
					</span>
					<span className="rounded-[4px] border border-[var(--color-border-subtle)] px-2 py-0.5">
						{messages.length} shown
					</span>
					<span className="rounded-[4px] border border-[var(--color-border-subtle)] px-2 py-0.5">
						{isCollapsed ? "expand" : "collapse"}
					</span>
				</div>
			</button>

			{!isCollapsed && (
				<div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
					{isLoading && (
						<p className="text-[11px] text-[var(--color-text-muted)]">
							Loading conversation stream...
						</p>
					)}

					{errorMessage && (
						<p className="text-[11px] text-[var(--color-status-error)]">
							{errorMessage}
						</p>
					)}

					{!isLoading && !errorMessage && snapshot && snapshot.teamId === null && (
						<p className="text-[11px] text-[var(--color-text-muted)]">
							No lead inbox discovered under <code>{snapshot.rootDir}</code>.
						</p>
					)}

					{!isLoading && !errorMessage && messages.length > 0 && (
						<div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
							{messages
								.slice()
								.reverse()
								.map((message, index) => (
									<ConversationMessageItem
										key={`${message.timestamp ?? "ts"}-${message.from}-${index}`}
										message={message}
									/>
								))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ConversationMessageItem({
	message,
}: {
	message: ConversationItem;
}) {
	return (
		<div className="rounded-[6px] border border-[rgba(148,163,184,0.2)] bg-[rgba(15,23,42,0.45)] px-3 py-2">
			<div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
				<span className="rounded-[4px] border border-[rgba(148,163,184,0.25)] px-1.5 py-0.5 font-semibold text-[var(--color-text-secondary)]">
					{message.from}
				</span>
				<span>{formatTimestamp({ iso: message.timestamp })}</span>
				{message.summary && (
					<span className="rounded-[4px] bg-[rgba(148,163,184,0.12)] px-1.5 py-0.5">
						{message.summary}
					</span>
				)}
				{message.repeatCount > 1 && (
					<span className="rounded-[4px] bg-[rgba(59,130,246,0.14)] px-1.5 py-0.5 text-[var(--color-accent)]">
						x{message.repeatCount}
					</span>
				)}
			</div>
			<p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
				{message.displayText}
			</p>
		</div>
	);
}
