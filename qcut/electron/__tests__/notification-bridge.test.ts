import { beforeEach, describe, expect, it } from "vitest";
import type { EditorEvent } from "../types/claude-api";
import { notificationBridge } from "../claude/notification-bridge";

function buildEvent({ eventId }: { eventId: string }): EditorEvent {
	return {
		eventId,
		timestamp: 1_706_000_000_000,
		category: "media.imported",
		action: "imported",
		source: "renderer.media-store",
		data: {
			name: "clip.mp4",
		},
	};
}

describe("notification bridge", () => {
	beforeEach(() => {
		notificationBridge.resetForTests();
	});

	it("enables and disables with status updates", () => {
		const enabled = notificationBridge.enable({ sessionId: "pty-1" });
		expect(enabled).toEqual({
			enabled: true,
			sessionId: "pty-1",
		});

		const disabled = notificationBridge.disable();
		expect(disabled).toEqual({
			enabled: false,
			sessionId: null,
		});
	});

	it("forwards formatted notifications to the configured writer", () => {
		const writes: Array<{ sessionId: string; data: string }> = [];
		notificationBridge.setWriter({
			writer: ({ sessionId, data }) => {
				writes.push({ sessionId, data });
				return true;
			},
		});
		notificationBridge.enable({ sessionId: "pty-abc" });

		notificationBridge.notify({ event: buildEvent({ eventId: "evt-1" }) });

		expect(writes).toHaveLength(1);
		expect(writes[0].sessionId).toBe("pty-abc");
		expect(writes[0].data).toContain("[QCut]");
		expect(writes[0].data).toContain('User imported media file "clip.mp4"');
	});

	it("does not forward when bridge is disabled", () => {
		let called = false;
		notificationBridge.setWriter({
			writer: () => {
				called = true;
				return true;
			},
		});

		notificationBridge.notify({ event: buildEvent({ eventId: "evt-2" }) });

		expect(called).toBe(false);
		expect(notificationBridge.getHistory()).toHaveLength(0);
	});

	it("keeps only the latest 50 history entries", () => {
		notificationBridge.setWriter({
			writer: () => true,
		});
		notificationBridge.enable({ sessionId: "pty-history" });

		for (let index = 0; index < 60; index++) {
			notificationBridge.notify({
				event: buildEvent({ eventId: `evt-${index}` }),
			});
		}

		const history = notificationBridge.getHistory();
		expect(history).toHaveLength(50);
		expect(history[0]).toContain("[QCut]");
		expect(notificationBridge.getHistory({ limit: 5 })).toHaveLength(5);
	});
});
