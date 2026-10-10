import { useEffect, useRef, useState } from "react";
import {
	applyPortraitPreset,
	createPortraitPreset,
	hasPortraitPresetContent,
	overwritePortraitPreset,
	parsePortraitPreset,
	parsePortraitPresetExport,
	renamePortraitPreset,
	serializePortraitPresets,
	type PortraitPresetScope,
	type SavedPortraitPreset,
} from "@/lib/portrait/portrait-presets";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitPresetControls } from "../portrait-preset-controls";

export const BEAUTY_LAB_PRESET_STORAGE_KEY = "qcut-beauty-lab-presets-v1";
const LAB_PRESETS_CHANGED_EVENT = "qcut:beauty-lab-presets-changed";
const MAX_IMPORT_BYTES = 1_000_000;

export interface BeautyLabPresetsProps {
	scope: PortraitPresetScope;
	adjustments: MediaPortraitAdjustments;
	locale: string;
	disabled: boolean;
	onChange: (value: MediaPortraitAdjustments) => void;
}

function labPreset({
	preset,
}: {
	preset: SavedPortraitPreset;
}): SavedPortraitPreset {
	// Lab presets carry editable values, never image-specific targets or brush actions.
	return {
		id: preset.id,
		name: preset.name,
		scope: preset.scope,
		createdAt: preset.createdAt,
		values: preset.values,
		...(preset.makeup ? { makeup: preset.makeup } : {}),
		...(preset.thumbnailDataUrl
			? { thumbnailDataUrl: preset.thumbnailDataUrl }
			: {}),
	};
}

function loadLabPresets(): SavedPortraitPreset[] {
	try {
		const stored: unknown = JSON.parse(
			localStorage.getItem(BEAUTY_LAB_PRESET_STORAGE_KEY) ?? "[]"
		);
		if (!Array.isArray(stored)) return [];
		return stored.flatMap((value) => {
			const parsed = parsePortraitPreset({ value });
			return parsed ? [labPreset({ preset: parsed })] : [];
		});
	} catch {
		return [];
	}
}

export function BeautyLabPresets({
	scope,
	adjustments,
	locale,
	disabled,
	onChange,
}: BeautyLabPresetsProps) {
	const [presets, setPresets] = useState(loadLabPresets);
	const [selectedId, setSelectedId] = useState<string>();
	const [error, setError] = useState<string | null>(null);
	const latest = useRef({ disabled, scope });
	latest.current = { disabled, scope };
	const mounted = useRef(false);
	const isZh = locale.startsWith("zh");
	const scopedPresets = presets.filter((preset) => preset.scope === scope);
	const selected = scopedPresets.find((preset) => preset.id === selectedId);
	useEffect(() => {
		mounted.current = true;
		const refresh = () => setPresets(loadLabPresets());
		const storageChanged = (event: StorageEvent) => {
			if (event.key === BEAUTY_LAB_PRESET_STORAGE_KEY || event.key === null)
				refresh();
		};
		window.addEventListener(LAB_PRESETS_CHANGED_EVENT, refresh);
		window.addEventListener("storage", storageChanged);
		return () => {
			mounted.current = false;
			window.removeEventListener(LAB_PRESETS_CHANGED_EVENT, refresh);
			window.removeEventListener("storage", storageChanged);
		};
	}, []);
	const updatePresets = ({
		update,
	}: {
		update: (current: SavedPortraitPreset[]) => SavedPortraitPreset[];
	}) => {
		if (latest.current.disabled) return false;
		try {
			const next = update(loadLabPresets());
			localStorage.setItem(BEAUTY_LAB_PRESET_STORAGE_KEY, JSON.stringify(next));
			setPresets(next);
			setError(null);
			window.dispatchEvent(new Event(LAB_PRESETS_CHANGED_EVENT));
			return true;
		} catch {
			setError(isZh ? "无法保存实验室预设" : "Could not save lab presets");
			return false;
		}
	};
	const supportedAdjustments: MediaPortraitAdjustments = {
		enabled: adjustments.enabled,
		values: adjustments.values,
		...(scope === "face" && adjustments.makeup
			? { makeup: adjustments.makeup }
			: {}),
	};
	const save = ({ name }: { name?: string }) => {
		if (disabled) return;
		const preset = labPreset({
			preset: createPortraitPreset({
				adjustments: supportedAdjustments,
				scope,
				name:
					name?.trim() ||
					(isZh
						? `${scope === "face" ? "美颜" : "美体"}预设`
						: `${scope === "face" ? "Face" : "Body"} preset`),
			}),
		});
		if (!hasPortraitPresetContent({ preset })) {
			setError(isZh ? "请先调整至少一个参数" : "Adjust a value first");
			return;
		}
		if (updatePresets({ update: (current) => [preset, ...current] }))
			setSelectedId(preset.id);
	};
	const apply = () => {
		if (disabled || !selected) return;
		const edited = applyPortraitPreset({ adjustments, preset: selected });
		onChange({ ...edited, faceTarget: adjustments.faceTarget });
	};
	const overwrite = () => {
		if (disabled || !selected) return;
		const replacement = createPortraitPreset({
			adjustments: supportedAdjustments,
			scope,
		});
		if (!hasPortraitPresetContent({ preset: replacement })) {
			setError(isZh ? "请先调整至少一个参数" : "Adjust a value first");
			return;
		}
		updatePresets({
			update: (current) =>
				overwritePortraitPreset({
					presets: current,
					id: selected.id,
					adjustments: supportedAdjustments,
				}).map((preset) => labPreset({ preset })),
		});
	};
	const exportPresets = () => {
		if (disabled) return;
		if (scopedPresets.length === 0) {
			setError(isZh ? "当前没有可导出的预设" : "No presets to export");
			return;
		}
		let url: string | undefined;
		try {
			url = URL.createObjectURL(
				new Blob([serializePortraitPresets({ presets: scopedPresets })], {
					type: "application/json",
				})
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = `qcut-beauty-lab-${scope}-presets.json`;
			link.click();
			setError(null);
		} catch {
			setError(isZh ? "无法导出实验室预设" : "Could not export lab presets");
		} finally {
			if (url) URL.revokeObjectURL(url);
		}
	};
	const importPresets = async ({ file }: { file: File }) => {
		if (disabled) return;
		const importScope = scope;
		try {
			if (file.size > MAX_IMPORT_BYTES)
				throw new Error("Preset file too large");
			const value: unknown = JSON.parse(await file.text());
			if (
				!mounted.current ||
				latest.current.disabled ||
				latest.current.scope !== importScope
			)
				return;
			const imported = parsePortraitPresetExport({ value })
				.filter((preset) => preset.scope === importScope)
				.map((preset) => labPreset({ preset }))
				.filter((preset) => hasPortraitPresetContent({ preset }));
			if (imported.length === 0) throw new Error("No presets for this scope");
			if (updatePresets({ update: (current) => [...imported, ...current] }))
				setSelectedId(imported[0].id);
		} catch {
			if (
				mounted.current &&
				!latest.current.disabled &&
				latest.current.scope === importScope
			) {
				setError(
					isZh
						? "预设文件无效、过大或没有当前分组的参数"
						: "Invalid, oversized, or incompatible preset file"
				);
			}
		}
	};

	return (
		<div
			className="min-w-0 [letter-spacing:0]"
			data-testid={`beauty-lab-${scope}-presets`}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<fieldset disabled={disabled} className="min-w-0 border-0 p-0">
				<PortraitPresetControls
					key={scope}
					selectContentClassName="z-[1100]"
					scope={scope}
					presets={scopedPresets}
					selectedPresetId={selected?.id}
					disabled={disabled}
					locale={isZh ? "zh" : "en"}
					onSelectedPresetChange={setSelectedId}
					onApplyPreset={apply}
					onSavePreset={(name) => save({ name })}
					onRenamePreset={({ id, name }) => {
						if (!scopedPresets.some((preset) => preset.id === id)) return;
						updatePresets({
							update: (current) =>
								renamePortraitPreset({ presets: current, id, name }),
						});
					}}
					onOverwritePreset={overwrite}
					onDeletePreset={() => {
						if (!selected) return;
						if (
							updatePresets({
								update: (current) =>
									current.filter((preset) => preset.id !== selected.id),
							})
						)
							setSelectedId(undefined);
					}}
					onExportPresets={exportPresets}
					onImportPresets={(file) => void importPresets({ file })}
				/>
			</fieldset>
			{error ? (
				<p role="alert" className="mt-2 break-words text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}
