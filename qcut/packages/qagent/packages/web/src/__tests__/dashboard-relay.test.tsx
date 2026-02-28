import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dashboard } from "@/components/Dashboard";
import { makeSession } from "./helpers";

class MockEventSource {
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(_url: string) {}

	close() {}
}

describe("Dashboard relay visibility", () => {
	beforeEach(() => {
		vi.stubGlobal("EventSource", MockEventSource as typeof EventSource);
	});

	it("hides relay sessions from main board by default", () => {
		render(
			<Dashboard
				sessions={[
					makeSession({ id: "dgame-1", managed: true }),
					makeSession({
						id: "relay-dgame0228223652-a",
						managed: false,
						metadata: { tmuxName: "relay-dgame0228223652-a" },
					}),
				]}
				stats={{
					totalSessions: 2,
					workingSessions: 2,
					openPRs: 0,
					needsReview: 0,
				}}
			/>
		);

		expect(screen.getByText("dgame-1")).toBeInTheDocument();
		expect(screen.queryByText("relay-dgame0228223652-a")).not.toBeInTheDocument();
		expect(screen.getByLabelText("show relay daemons")).toBeInTheDocument();
	});

	it("shows relay panel when relay toggle is enabled", () => {
		render(
			<Dashboard
				sessions={[
					makeSession({ id: "dgame-1", managed: true }),
					makeSession({
						id: "relay-dgame0228223652-a",
						managed: false,
						metadata: { tmuxName: "relay-dgame0228223652-a" },
					}),
				]}
				stats={{
					totalSessions: 2,
					workingSessions: 2,
					openPRs: 0,
					needsReview: 0,
				}}
			/>
		);

		fireEvent.click(screen.getByLabelText("show relay daemons"));

		expect(screen.getByText("Relay Daemons")).toBeInTheDocument();
		expect(screen.getByText("relay-dgame0228223652-a")).toBeInTheDocument();
	});
});
