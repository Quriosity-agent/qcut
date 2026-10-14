import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TProject } from "@/types/project";
import { useProjectStore } from "@/stores/project-store";
import { waitForProjectOpen } from "../claude-navigator-bridge";

/** Mirrors loadProject: the project becomes active first, loaded last. */
function setActiveProject({
	id,
	loaded = true,
}: {
	id: string | null;
	loaded?: boolean;
}) {
	useProjectStore.setState({
		activeProject: id ? ({ id } as TProject) : null,
		loadedProjectId: id && loaded ? id : null,
	});
}

async function changeHash({ hash }: { hash: string }) {
	window.location.hash = hash;
	// jsdom queues hashchange as a task.
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("waitForProjectOpen", () => {
	beforeEach(async () => {
		setActiveProject({ id: null });
		await changeHash({ hash: "#/projects" });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("answers only once the editor holds the project", async () => {
		const opened = waitForProjectOpen({ projectId: "p1", timeoutMs: 1000 });
		let settled = false;
		void opened.then(() => {
			settled = true;
		});

		await changeHash({ hash: "#/editor/p1" });
		expect(settled).toBe(false);

		// Active but still loading its timeline: not open yet.
		setActiveProject({ id: "p1", loaded: false });
		await Promise.resolve();
		expect(settled).toBe(false);

		setActiveProject({ id: "p1" });
		await expect(opened).resolves.toEqual({ navigated: true });
	});

	it("reports a redirect to another project as not opened", async () => {
		const opened = waitForProjectOpen({ projectId: "p1", timeoutMs: 1000 });
		await changeHash({ hash: "#/editor/p1" });
		// A missing project is replaced by a new one under another id.
		await changeHash({ hash: "#/editor/new-project" });

		await expect(opened).resolves.toMatchObject({
			navigated: false,
			error: expect.stringContaining("#/editor/new-project"),
		});
	});

	it("reports a load that never finishes as not opened", async () => {
		vi.useFakeTimers();
		const opened = waitForProjectOpen({ projectId: "p1", timeoutMs: 500 });
		window.location.hash = "#/editor/p1";

		await vi.advanceTimersByTimeAsync(500);

		await expect(opened).resolves.toMatchObject({
			navigated: false,
			error: expect.stringContaining("within 0.5s"),
		});
	});

	it("answers at once when the project is already open", async () => {
		await changeHash({ hash: "#/editor/p1" });
		setActiveProject({ id: "p1" });

		await expect(
			waitForProjectOpen({ projectId: "p1", timeoutMs: 1000 })
		).resolves.toEqual({ navigated: true });
	});
});
