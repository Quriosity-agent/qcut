import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useLocaleStore } from "@/stores/locale-store";
import { VideoMultiSelectionProperties } from "../video-multi-selection-properties";

function clip({
	id,
	...overrides
}: Partial<MediaElement> & { id: string }): MediaElement {
	return {
		id,
		name: id,
		mediaId: id,
		type: "media",
		duration: 4,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		...overrides,
	};
}

function Harness() {
	const tracks = useTimelineStore((state) => state.tracks);
	return (
		<VideoMultiSelectionProperties
			selections={tracks.flatMap((track) =>
				track.elements.flatMap((element) =>
					element.type === "media" ? [{ trackId: track.id, element }] : []
				)
			)}
		/>
	);
}

function media(): MediaElement[] {
	return useTimelineStore
		.getState()
		.tracks.flatMap((track) =>
			track.elements.filter(
				(element): element is MediaElement => element.type === "media"
			)
		);
}

beforeEach(() => {
	const tracks: TimelineTrack[] = [
		{
			id: "main",
			name: "Main",
			type: "media",
			isMain: true,
			elements: [
				clip({ id: "a", x: 10, scaleX: 1, scaleY: 1, y: 7 }),
				clip({ id: "b", x: 40, scaleX: 2, scaleY: 2, y: 7 }),
			],
		},
	];
	useTimelineStore.setState({
		_tracks: tracks,
		tracks,
		history: [],
		redoStack: [],
		selectedElements: [],
		selectedTransition: null,
	});
	usePlaybackStore.getState().setDuration(4);
	usePlaybackStore.getState().seek(0);
	usePlaybackStore.setState({ isPlaying: false });
	useLocaleStore.getState().setLocale({ locale: "zh" });
});

afterEach(() => {
	cleanup();
	clearAutoSaveTimer();
	vi.restoreAllMocks();
});

describe("video batch properties", () => {
	it("shows mixed and shared values without averaging different clips", () => {
		render(<Harness />);
		expect(
			screen.getByTestId("video-multi-selection-properties")
		).toHaveTextContent("2 个视频片段");
		expect(screen.getByRole("spinbutton", { name: "位置 X" })).toHaveAttribute(
			"placeholder",
			"混合值"
		);
		expect(screen.getByRole("spinbutton", { name: "位置 X" })).toHaveValue(
			null
		);
		expect(screen.getByRole("spinbutton", { name: "位置 Y" })).toHaveValue(7);
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("commits one field once on Enter, not on typing or the subsequent blur", () => {
		render(<Harness />);
		const field = screen.getByRole("spinbutton", { name: "位置 X" });
		fireEvent.focus(field);
		fireEvent.change(field, { target: { value: "1" } });
		fireEvent.change(field, { target: { value: "120" } });
		expect(media().map((element) => element.x)).toEqual([10, 40]);
		fireEvent.keyDown(field, { key: "Enter" });
		fireEvent.blur(field);
		expect(media().map((element) => [element.x, element.y])).toEqual([
			[120, 7],
			[120, 7],
		]);
		expect(useTimelineStore.getState().history).toHaveLength(1);
		act(() => useTimelineStore.getState().undo());
		expect(media().map((element) => element.x)).toEqual([10, 40]);
		expect(screen.getByRole("spinbutton", { name: "位置 X" })).toHaveValue(
			null
		);
	});

	it("commits on blur and cancels blank or escaped drafts without history", () => {
		render(<Harness />);
		const field = screen.getByRole("spinbutton", { name: "位置 Y" });
		fireEvent.change(field, { target: { value: "" } });
		fireEvent.blur(field);
		expect(field).toHaveValue(7);
		fireEvent.change(field, { target: { value: "99" } });
		fireEvent.keyDown(field, { key: "Escape" });
		fireEvent.blur(field);
		expect(useTimelineStore.getState().history).toHaveLength(0);
		fireEvent.change(field, { target: { value: "21" } });
		fireEvent.blur(field);
		expect(media().map((element) => element.y)).toEqual([21, 21]);
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});

	it("applies a relative scale once and resets the adjustment field to zero", () => {
		render(<Harness />);
		fireEvent.change(screen.getByRole("combobox", { name: "修改方式" }), {
			target: { value: "adjust" },
		});
		const field = screen.getByRole("spinbutton", { name: "水平缩放" });
		expect(field).toHaveValue(0);
		fireEvent.change(field, { target: { value: "20" } });
		fireEvent.keyDown(field, { key: "Enter" });
		fireEvent.blur(field);
		expect(media().map((element) => [element.scaleX, element.scaleY])).toEqual([
			[1.2, 1.2],
			[2.4, 2.4],
		]);
		expect(useTimelineStore.getState().history).toHaveLength(1);
		expect(screen.getByRole("spinbutton", { name: "水平缩放" })).toHaveValue(0);
	});

	it("disables every field when an explicitly selected track is locked", () => {
		const tracks = useTimelineStore
			.getState()
			.tracks.map((track) => ({ ...track, locked: true }));
		useTimelineStore.setState({ _tracks: tracks, tracks });
		render(<Harness />);
		for (const field of screen.getAllByRole("spinbutton"))
			expect(field).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent("锁定轨道");
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("requires paused playback before editing and does not save on pause", () => {
		usePlaybackStore.setState({ isPlaying: true });
		render(<Harness />);
		expect(screen.getByRole("spinbutton", { name: "位置 X" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "暂停后编辑" }));
		expect(usePlaybackStore.getState().isPlaying).toBe(false);
		expect(
			screen.getByRole("spinbutton", { name: "位置 X" })
		).not.toBeDisabled();
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("discards an uncommitted draft if the playhead moves", () => {
		render(<Harness />);
		fireEvent.change(screen.getByRole("spinbutton", { name: "位置 Y" }), {
			target: { value: "99" },
		});
		act(() => usePlaybackStore.getState().seek(1));
		expect(screen.getByRole("spinbutton", { name: "位置 Y" })).toHaveValue(7);
		expect(media().map((element) => element.y)).toEqual([7, 7]);
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});
});
