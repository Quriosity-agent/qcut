import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPortraitPreset,
	PORTRAIT_PRESETS_CHANGED_EVENT,
	PORTRAIT_PRESET_STORAGE_KEY,
	serializePortraitPresets,
	type SavedPortraitPreset,
} from "@/lib/portrait/portrait-presets";
import { act, fireEvent, render, screen, waitFor } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	BEAUTY_LAB_PRESET_STORAGE_KEY,
	BeautyLabPresets,
	type BeautyLabPresetsProps,
} from "../beauty-lab/beauty-lab-presets";
import { PortraitPresetControls } from "../portrait-preset-controls";

const initial: MediaPortraitAdjustments = {
	enabled: false,
	values: {
		face_adjust_Smooth: 40,
		face_adjust_TotalFace: 25,
		body_adjust_SlimWaist: 70,
	},
	faceTarget: { mode: "single", faceId: 42 },
	makeup: { lip: { cardId: "lip-soft-pink", intensity: 55 } },
	faces: [{ trackId: 73, values: { face_adjust_Smooth: 80 } }],
};

function Harness({
	scope = "face",
	adjustments: starting = initial,
	locale = "en",
	disabled = false,
	onChange = vi.fn(),
}: Partial<BeautyLabPresetsProps>) {
	const [adjustments, setAdjustments] = useState(starting);
	return (
		<>
			<BeautyLabPresets
				scope={scope}
				adjustments={adjustments}
				locale={locale}
				disabled={disabled}
				onChange={(value) => {
					setAdjustments(value);
					onChange(value);
				}}
			/>
			<output data-testid="adjustments">{JSON.stringify(adjustments)}</output>
		</>
	);
}

function stored(): SavedPortraitPreset[] {
	return JSON.parse(
		localStorage.getItem(BEAUTY_LAB_PRESET_STORAGE_KEY) ?? "[]"
	);
}

function save({
	scope = "Retouch",
	name = "Lab portrait",
}: {
	scope?: string;
	name?: string;
} = {}) {
	fireEvent.change(screen.getByLabelText(`${scope} preset name`), {
		target: { value: name },
	});
	fireEvent.click(screen.getByRole("button", { name: `Save ${scope} preset` }));
}

function preset({
	scope = "face",
	name = "Imported portrait",
}: {
	scope?: "face" | "body";
	name?: string;
} = {}) {
	return createPortraitPreset({ adjustments: initial, scope, name });
}

function importFile({
	container,
	text,
	size = 100,
}: {
	container: HTMLElement;
	text: () => Promise<string>;
	size?: number;
}) {
	const file = new File(["{}"], "lab.json", { type: "application/json" });
	Object.defineProperty(file, "text", { value: text });
	Object.defineProperty(file, "size", { value: size });
	const input = container.querySelector('input[type="file"]');
	if (!input) throw new Error("Missing import input");
	fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.mocked(localStorage.getItem).mockImplementation(
		(key) => storage.get(key) ?? null
	);
	vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
		storage.set(key, value);
	});
});
afterEach(() => vi.restoreAllMocks());

describe("Beauty Lab isolated presets", () => {
	it("layers the lab preset portal above the dialog", () => {
		render(<Harness />);
		save();
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		const menu = screen.getByRole("listbox");
		expect(menu).toHaveClass("z-[1100]");
		expect(menu).not.toHaveClass("z-50");
		expect(screen.getByTestId("beauty-lab-face-presets").contains(menu)).toBe(
			false
		);
	});

	it("keeps the shared preset portal default unchanged without an override", () => {
		render(
			<PortraitPresetControls
				scope="face"
				presets={[preset()]}
				selectedPresetId={undefined}
				disabled={false}
				locale="en"
				onSelectedPresetChange={vi.fn()}
				onApplyPreset={vi.fn()}
				onDeletePreset={vi.fn()}
				onSavePreset={vi.fn()}
				onRenamePreset={vi.fn()}
				onOverwritePreset={vi.fn()}
				onExportPresets={vi.fn()}
				onImportPresets={vi.fn()}
			/>
		);
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.getByRole("listbox")).toHaveClass("z-50");
		expect(screen.getByRole("listbox")).not.toHaveClass("z-[1100]");
	});

	it("never loads/writes official presets or emits official preset events", () => {
		const official = JSON.stringify([preset({ name: "Official" })]);
		localStorage.setItem(PORTRAIT_PRESET_STORAGE_KEY, official);
		const officialEvent = vi.fn();
		window.addEventListener(PORTRAIT_PRESETS_CHANGED_EVENT, officialEvent);
		const onChange = vi.fn();
		render(<Harness onChange={onChange} />);
		expect(screen.getByRole("combobox")).toBeDisabled();
		save();
		expect(stored()).toHaveLength(1);
		expect(localStorage.getItem(PORTRAIT_PRESET_STORAGE_KEY)).toBe(official);
		expect(officialEvent).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		window.removeEventListener(PORTRAIT_PRESETS_CHANGED_EVENT, officialEvent);
	});

	it("stores face and body values separately without image targets or per-person sets", () => {
		const view = render(<Harness />);
		save({ name: "  Face test  " });
		view.rerender(<Harness scope="body" />);
		save({ scope: "Body", name: "Body test" });
		expect(stored()).toEqual([
			expect.objectContaining({
				name: "Body test",
				scope: "body",
				values: { body_adjust_SlimWaist: 70 },
			}),
			expect.objectContaining({
				name: "Face test",
				scope: "face",
				values: { face_adjust_Smooth: 40, face_adjust_TotalFace: 25 },
				makeup: initial.makeup,
			}),
		]);
		for (const item of stored()) {
			expect(item).not.toHaveProperty("faceTarget");
			expect(item).not.toHaveProperty("faces");
			expect(item).not.toHaveProperty("manualBody");
		}
	});

	it("applies a face preset as a replacement while preserving the current target, other people and body", () => {
		const face = preset();
		localStorage.setItem(BEAUTY_LAB_PRESET_STORAGE_KEY, JSON.stringify([face]));
		render(
			<Harness
				adjustments={{
					...initial,
					values: {
						face_adjust_Smooth: 5,
						face_adjust_Whiten: 12,
						body_adjust_SlimWaist: 99,
					},
					makeup: undefined,
				}}
			/>
		);
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		fireEvent.keyDown(screen.getByRole("option", { name: face.name }), {
			key: "Enter",
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Apply Retouch preset" })
		);
		const edited: MediaPortraitAdjustments = JSON.parse(
			screen.getByTestId("adjustments").textContent ?? "{}"
		);
		expect(edited).toEqual({
			...initial,
			enabled: true,
			values: {
				face_adjust_Smooth: 40,
				face_adjust_TotalFace: 25,
				body_adjust_SlimWaist: 99,
			},
		});
	});

	it("applies body presets without changing face values, makeup, or face targeting", () => {
		render(<Harness scope="body" />);
		save({ scope: "Body" });
		fireEvent.click(screen.getByRole("button", { name: "Apply Body preset" }));
		expect(
			JSON.parse(screen.getByTestId("adjustments").textContent ?? "{}")
		).toEqual({ ...initial, enabled: true });
	});

	it("renames through the real shared UI and ignores blank names", () => {
		render(<Harness />);
		save();
		fireEvent.click(screen.getByRole("button", { name: "Rename preset" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Rename preset" }), {
			target: { value: "  Clean portrait  " },
		});
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename preset" }), {
			key: "Enter",
		});
		expect(stored()[0].name).toBe("Clean portrait");
		fireEvent.click(screen.getByRole("button", { name: "Rename preset" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Rename preset" }), {
			target: { value: "  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm rename" }));
		expect(stored()[0].name).toBe("Clean portrait");
	});

	it("overwrites values without changing preset identity or the other scope", () => {
		const body = preset({ scope: "body" });
		localStorage.setItem(BEAUTY_LAB_PRESET_STORAGE_KEY, JSON.stringify([body]));
		const view = render(
			<BeautyLabPresets
				scope="face"
				adjustments={initial}
				locale="en"
				disabled={false}
				onChange={vi.fn()}
			/>
		);
		save();
		const original = stored()[0];
		view.rerender(
			<BeautyLabPresets
				scope="face"
				adjustments={{ ...initial, values: { face_adjust_Smooth: 90 } }}
				locale="en"
				disabled={false}
				onChange={vi.fn()}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Overwrite preset" }));
		expect(stored()[0]).toEqual({
			...original,
			values: { face_adjust_Smooth: 90 },
		});
		expect(stored()[1]).toMatchObject({ id: body.id, values: body.values });
	});

	it("deletes only the selected lab preset and disables stale selection", () => {
		const body = preset({ scope: "body" });
		localStorage.setItem(BEAUTY_LAB_PRESET_STORAGE_KEY, JSON.stringify([body]));
		render(<Harness />);
		save();
		fireEvent.click(
			screen.getByRole("button", { name: "Delete Retouch preset" })
		);
		expect(stored()).toHaveLength(1);
		expect(stored()[0].id).toBe(body.id);
		expect(
			screen.getByRole("button", { name: "Apply Retouch preset" })
		).toBeDisabled();
	});

	it("rejects empty drafts and empty exports with localized errors", () => {
		render(<Harness adjustments={{ enabled: false, values: {} }} />);
		save();
		expect(screen.getByRole("alert")).toHaveTextContent("Adjust a value first");
		fireEvent.click(screen.getByRole("button", { name: "Export presets" }));
		expect(screen.getByRole("alert")).toHaveTextContent("No presets to export");
		expect(stored()).toEqual([]);
	});

	it("imports validated current-scope values with fresh ids, bounded thumbnails, and no brush or target payloads", async () => {
		const face = {
			...preset(),
			values: {
				face_adjust_Smooth: 67,
				body_adjust_SlimWaist: 15,
				unknown: 40,
			},
			faceTarget: { mode: "single" as const, faceId: 600 },
			thumbnailDataUrl: "data:text/html;base64,AA==",
		};
		const body = preset({ scope: "body" });
		const view = render(<Harness />);
		importFile({
			container: view.container,
			text: async () => serializePortraitPresets({ presets: [face, body] }),
		});
		await waitFor(() => expect(stored()).toHaveLength(1));
		expect(stored()[0]).toMatchObject({
			name: face.name,
			scope: "face",
			values: { face_adjust_Smooth: 67 },
		});
		expect(stored()[0].id).not.toBe(face.id);
		expect(stored()[0]).not.toHaveProperty("faceTarget");
		expect(stored()[0]).not.toHaveProperty("thumbnailDataUrl");
	});

	it.each([
		{ label: "malformed JSON", text: "{bad" },
		{ label: "wrong kind", text: '{"kind":"other","version":1,"presets":[]}' },
		{
			label: "unsupported version",
			text: '{"kind":"qcut-portrait-presets","version":9,"presets":[]}',
		},
		{
			label: "empty preset list",
			text: '{"kind":"qcut-portrait-presets","version":1,"presets":[]}',
		},
		{
			label: "wrong scope",
			text: serializePortraitPresets({ presets: [preset({ scope: "body" })] }),
		},
	])("rejects $label imports without altering storage", async ({ text }) => {
		const view = render(<Harness />);
		importFile({ container: view.container, text: async () => text });
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Invalid, oversized, or incompatible preset file"
		);
		expect(stored()).toEqual([]);
	});

	it("rejects oversized files before reading them", async () => {
		const text = vi.fn(async () => "{}");
		const view = render(<Harness />);
		importFile({ container: view.container, text, size: 1_000_001 });
		expect(await screen.findByRole("alert")).toBeInTheDocument();
		expect(text).not.toHaveBeenCalled();
	});

	it("exports only the current scope with a lab filename and releases the blob URL", async () => {
		const view = render(<Harness />);
		save();
		view.rerender(<Harness scope="body" />);
		save({ scope: "Body" });
		const download = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		fireEvent.click(screen.getByRole("button", { name: "Export presets" }));
		expect(download).toHaveBeenCalledTimes(1);
		const link = download.mock.instances[0];
		if (!(link instanceof HTMLAnchorElement))
			throw new Error("Expected download link");
		expect(link.download).toBe("qcut-beauty-lab-body-presets.json");
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
		const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0];
		if (!(blob instanceof Blob)) throw new Error("Expected export blob");
		const text = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error("Failed to read export"));
			reader.readAsText(blob);
		});
		const exported = JSON.parse(text);
		expect(exported).toMatchObject({
			kind: "qcut-portrait-presets",
			version: 1,
		});
		expect(exported.presets).toHaveLength(1);
		expect(exported.presets[0].scope).toBe("body");
	});

	it.each([
		"click",
		"Enter",
	] as const)("guards an open rename after disabling via %s", (action) => {
		const view = render(<Harness />);
		save();
		fireEvent.click(screen.getByRole("button", { name: "Rename preset" }));
		view.rerender(<Harness disabled />);
		const before = stored();
		expect(
			screen.getByRole("textbox", { name: "Rename preset" })
		).toBeDisabled();
		if (action === "click")
			fireEvent.click(screen.getByRole("button", { name: "Confirm rename" }));
		if (action === "Enter")
			fireEvent.keyDown(
				screen.getByRole("textbox", { name: "Rename preset" }),
				{ key: "Enter" }
			);
		expect(stored()).toEqual(before);
	});

	it.each([
		"disabled",
		"scope",
		"unmounted",
	] as const)("ignores an async import after becoming %s", async (change) => {
		let resolveText: (value: string) => void = () => {
			throw new Error("Reader not initialized");
		};
		const pending = new Promise<string>((resolve) => {
			resolveText = resolve;
		});
		const view = render(<Harness />);
		importFile({ container: view.container, text: () => pending });
		if (change === "unmounted") view.unmount();
		if (change === "disabled") view.rerender(<Harness disabled />);
		if (change === "scope") view.rerender(<Harness scope="body" />);
		await act(async () =>
			resolveText(serializePortraitPresets({ presets: [preset()] }))
		);
		expect(stored()).toEqual([]);
	});

	it("recovers from corrupt lab storage and reports quota failures without pretending to save", () => {
		localStorage.setItem(BEAUTY_LAB_PRESET_STORAGE_KEY, "bad JSON");
		render(<Harness />);
		vi.mocked(localStorage.setItem).mockImplementation(() => {
			throw new Error("quota exceeded");
		});
		save();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Could not save lab presets"
		);
		expect(
			screen.getByRole("button", { name: "Apply Retouch preset" })
		).toBeDisabled();
	});

	it("refreshes only from lab storage changes and invalidates deleted selection", () => {
		render(<Harness />);
		save();
		localStorage.setItem(BEAUTY_LAB_PRESET_STORAGE_KEY, "[]");
		act(() =>
			window.dispatchEvent(
				new StorageEvent("storage", { key: PORTRAIT_PRESET_STORAGE_KEY })
			)
		);
		expect(
			screen.getByRole("button", { name: "Apply Retouch preset" })
		).not.toBeDisabled();
		act(() =>
			window.dispatchEvent(
				new StorageEvent("storage", { key: BEAUTY_LAB_PRESET_STORAGE_KEY })
			)
		);
		expect(
			screen.getByRole("button", { name: "Apply Retouch preset" })
		).toBeDisabled();
	});
});
