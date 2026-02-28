import { describe, expect, it, vi } from "vitest";
import { UtilityPtyManager } from "../utility/utility-pty-manager";

describe("notification PTY integration", () => {
	it("writes notification lines to PTY output stream", () => {
		const postMessage = vi.fn();
		const manager = new UtilityPtyManager({
			postMessage,
		} as unknown as import("node:worker_threads").MessagePort);

		(
			manager as unknown as {
				sessions: Map<string, { id: string; process: { write: () => void } }>;
			}
		).sessions.set("pty-1", {
			id: "pty-1",
			process: {
				write: () => {},
			},
		});

		manager.output("pty-1", "[QCut] 10:00:00 - User imported media");

		expect(postMessage).toHaveBeenCalledWith({
			type: "pty:data",
			sessionId: "pty-1",
			data: "[QCut] 10:00:00 - User imported media\r\n",
		});
	});

	it("ignores output messages for unknown sessions", () => {
		const postMessage = vi.fn();
		const manager = new UtilityPtyManager({
			postMessage,
		} as unknown as import("node:worker_threads").MessagePort);

		manager.output("missing-session", "[QCut] ignored");

		expect(postMessage).not.toHaveBeenCalled();
	});
});
