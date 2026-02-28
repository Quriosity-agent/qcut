import { describe, expect, it } from "vitest";
import type { EditorEvent } from "../types/claude-api";
import {
	formatOperationForTerminal,
	toOperationNotification,
} from "../claude/utils/operation-formatter";

function buildEvent({
	category,
	action,
	source = "renderer.timeline-store",
	data = {},
	timestamp = 1_706_000_000_000,
}: {
	category: EditorEvent["category"];
	action: EditorEvent["action"];
	source?: string;
	data?: Record<string, unknown>;
	timestamp?: number;
}): EditorEvent {
	return {
		eventId: "evt_test_1",
		timestamp,
		category,
		action,
		source,
		data,
	};
}

describe("operation formatter", () => {
	it("formats timeline add notifications with content and position", () => {
		const event = buildEvent({
			category: "timeline.elementAdded",
			action: "elementAdded",
			data: {
				element: {
					type: "text",
					content: "Title",
					startTime: 3.2,
				},
			},
		});

		const formatted = formatOperationForTerminal({ event });
		expect(formatted).toMatch(/^\[QCut] \d{2}:\d{2}:\d{2} - /);
		expect(formatted).toContain(
			'User added text element "Title" to timeline at 00:03.200'
		);
	});

	it("formats media import notifications", () => {
		const event = buildEvent({
			category: "media.imported",
			action: "imported",
			source: "renderer.media-store",
			data: {
				name: "clip.mp4",
			},
		});

		const formatted = formatOperationForTerminal({ event });
		expect(formatted).toContain('User imported media file "clip.mp4"');
	});

	it("formats export start notifications", () => {
		const event = buildEvent({
			category: "export.started",
			action: "started",
			source: "main.export-handler",
			data: {
				presetId: "youtube-1080p",
			},
		});

		const formatted = formatOperationForTerminal({ event });
		expect(formatted).toContain(
			'User started export (preset: "youtube-1080p")'
		);
	});

	it("formats all remaining notifiable categories", () => {
		const cases: Array<{
			event: EditorEvent;
			expected: string;
		}> = [
			{
				event: buildEvent({
					category: "timeline.elementUpdated",
					action: "elementUpdated",
					data: { after: { type: "video" } },
				}),
				expected: "User updated video element on timeline",
			},
			{
				event: buildEvent({
					category: "timeline.elementRemoved",
					action: "elementRemoved",
					data: { element: { type: "audio" } },
				}),
				expected: "User removed audio element from timeline",
			},
			{
				event: buildEvent({
					category: "project.settingsChanged",
					action: "settingsChanged",
					source: "renderer.project-store",
					data: { name: "Demo Project" },
				}),
				expected: 'User updated project settings for "Demo Project"',
			},
			{
				event: buildEvent({
					category: "export.completed",
					action: "completed",
					source: "main.export-handler",
					data: { outputPath: "/tmp/output.mp4" },
				}),
				expected: 'Export completed: "/tmp/output.mp4"',
			},
			{
				event: buildEvent({
					category: "export.failed",
					action: "failed",
					source: "main.export-handler",
					data: { error: "Disk full" },
				}),
				expected: "Export failed: Disk full",
			},
		];

		for (const entry of cases) {
			const formatted = formatOperationForTerminal({ event: entry.event });
			expect(formatted).toContain(entry.expected);
		}
	});

	it("filters non-notifiable categories", () => {
		const event = buildEvent({
			category: "export.progress",
			action: "progress",
			source: "main.export-handler",
			data: { progress: 0.5 },
		});

		expect(formatOperationForTerminal({ event })).toBeNull();
	});

	it("filters non-user timeline events", () => {
		const event = buildEvent({
			category: "timeline.elementUpdated",
			action: "elementUpdated",
			source: "main.system-maintenance",
		});

		expect(formatOperationForTerminal({ event })).toBeNull();
	});

	it("normalizes source into operation notification metadata", () => {
		const event = buildEvent({
			category: "media.deleted",
			action: "deleted",
			source: "cli.batch-delete",
		});

		const notification = toOperationNotification({ event });
		expect(notification?.source).toBe("cli");
		expect(notification?.operation).toBe("media.delete");
	});
});
