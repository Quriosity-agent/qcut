import "@/test/fix-radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";

const storage = vi.hoisted(() => ({
	loadProject: vi.fn(),
	saveProject: vi.fn(async () => {}),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));

import { createDefaultProjectAudioMixSettings } from "@/lib/audio/audio-mix-settings";
import { useProjectStore } from "@/stores/project-store";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineTrack } from "@/types/timeline";
import { MixerView } from "../mixer-view";

/** The mixer panel on the real stores: what it shows and what it changes. */

function tracks(): TimelineTrack[] {
	return [
		{ id: "guns", name: "SFX · Guns", type: "audio", elements: [] },
		{ id: "music", name: "Music", type: "audio", elements: [] },
		{ id: "titles", name: "Titles", type: "text", elements: [] },
	];
}

const trackAudio = (trackId: string) =>
	useTimelineStore.getState().tracks.find((track) => track.id === trackId);

function setLevel(testId: string, value: string) {
	const input = screen.getByTestId(`${testId}-value`);
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.blur(input);
}

describe("mixer panel", () => {
	beforeEach(() => {
		const initial = tracks();
		useTimelineStore.setState({
			_tracks: initial,
			tracks: initial,
			history: [],
			redoStack: [],
		});
		useProjectStore.setState({
			loadedProjectId: "p",
			activeProject: {
				id: "p",
				name: "Doors",
				audioMix: createDefaultProjectAudioMixSettings(),
			} as never,
		});
	});
	afterEach(() => clearAutoSaveTimer());

	it("shows a strip for each audio track, the master, and no buses yet", () => {
		render(<MixerView />);
		expect(screen.getByTestId("mixer-track-guns")).toBeTruthy();
		expect(screen.getByTestId("mixer-track-music")).toBeTruthy();
		expect(screen.queryByTestId("mixer-track-titles")).toBeNull();
		expect(screen.getByTestId("mixer-bus-master")).toBeTruthy();
		expect(screen.getByTestId("mixer-loudness")).toBeTruthy();
	});

	it("sets a track's level from its value box, as one undo step", () => {
		render(<MixerView />);
		setLevel("mixer-track-guns-level", "-6");
		expect(trackAudio("guns")?.audio?.gainDb).toBe(-6);
		expect(useTimelineStore.getState().history).toHaveLength(1);
		expect(
			(screen.getByTestId("mixer-track-guns-level-value") as HTMLInputElement)
				.value
		).toBe("-6.0");
	});

	it("mutes and solos, and greys out what the solo silences", () => {
		render(<MixerView />);
		fireEvent.click(screen.getByTestId("mixer-track-guns-mute"));
		expect(trackAudio("guns")?.muted).toBe(true);
		fireEvent.click(screen.getByTestId("mixer-track-guns-solo"));
		expect(trackAudio("guns")?.audio?.solo).toBe(true);
		expect(
			screen.getByTestId("mixer-track-music").getAttribute("data-silenced")
		).toBe("true");
	});

	it("adds a bus and sends a track to it by dropping the track on it", async () => {
		render(<MixerView />);
		await act(async () => {
			fireEvent.click(screen.getByTestId("mixer-add-bus"));
		});
		const busId = useProjectStore.getState().activeProject?.audioMix?.buses[0]
			?.id as string;
		expect(busId).toBeTruthy();
		const busRow = await screen.findByTestId(`mixer-bus-${busId}`);

		const dataTransfer = {
			types: ["application/x-qcut-mixer-track"],
			getData: () => "guns",
			dropEffect: "none",
		};
		fireEvent.dragOver(busRow, { dataTransfer });
		fireEvent.drop(busRow, { dataTransfer });
		expect(trackAudio("guns")?.audio?.busId).toBe(busId);
	});

	it("writes a level curve from the automation editor and greys the fader out", async () => {
		render(<MixerView />);
		await act(async () => {
			fireEvent.click(screen.getByTestId("mixer-track-guns-automation"));
		});
		await act(async () => {
			fireEvent.click(
				await screen.findByTestId(
					"mixer-track-guns-automation-editor-gainDb-add"
				)
			);
		});
		expect(trackAudio("guns")?.audio?.automation).toEqual({
			gainDb: [{ time: 0, value: 0 }],
		});
		expect(
			screen
				.getByTestId("mixer-track-guns-level")
				.getAttribute("data-automated")
		).toBe("true");
	});

	it("sets the master's level and saves it", async () => {
		render(<MixerView />);
		await act(async () => {
			setLevel("mixer-bus-master-level", "-1");
		});
		await waitFor(() =>
			expect(
				useProjectStore.getState().activeProject?.audioMix?.master.gainDb
			).toBe(-1)
		);
		expect(storage.saveProject).toHaveBeenCalled();
	});
});
