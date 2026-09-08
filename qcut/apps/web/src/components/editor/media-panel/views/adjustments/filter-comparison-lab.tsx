import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FilterComparisonResult } from "@/types/electron";
import {
	comparisonTestImage,
	readComparisonImage,
} from "./filter-comparison-input";
import { FilterComparisonResults } from "./filter-comparison-results";

export function FilterComparisonLab() {
	const [input, setInput] = useState(comparisonTestImage);
	const [intensity, setIntensity] = useState(100);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [result, setResult] = useState<FilterComparisonResult>();
	const generation = useRef(0);
	useEffect(
		() => () => {
			generation.current++;
		},
		[]
	);
	const api = window.electronAPI?.qcutIndependentFilter;
	const supported = typeof api?.compare === "function";
	const selectImage = async ({ file }: { file: File }) => {
		const current = ++generation.current;
		setBusy(true);
		setError("");
		setResult(undefined);
		try {
			const next = await readComparisonImage({ file });
			if (current === generation.current) setInput(next);
		} catch (cause) {
			if (current === generation.current)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (current === generation.current) setBusy(false);
		}
	};
	const compare = async () => {
		if (!api?.compare || busy) return;
		const current = ++generation.current;
		setBusy(true);
		setError("");
		setResult(undefined);
		try {
			const response = await api.compare({
				resourceId: "7160594413847203085",
				version: "e745e131cff1db913aea07f4098ec8de",
				width: input.width,
				height: input.height,
				rgba: input.rgba,
				intensity,
			});
			if (current === generation.current) setResult(response);
		} catch (cause) {
			if (current === generation.current)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (current === generation.current) setBusy(false);
		}
	};
	return (
		<section
			className="space-y-3 p-2"
			aria-label="滤镜算法对照"
			data-testid="filter-comparison-lab"
		>
			<div className="space-y-1">
				<h3 className="text-sm font-medium">迷雾 · 算法对照</h3>
				<p className="text-xs text-muted-foreground">
					同一图片和强度，比较 QCut Metal 与独立
					C++。图片在本机处理，不修改时间线。
				</p>
			</div>
			{!supported && (
				<p role="alert" className="text-xs">
					请在支持算法对照的 QCut macOS 桌面版中打开。
				</p>
			)}
			<label className="block space-y-1 text-xs">
				<span>选择图片</span>
				<input
					type="file"
					accept="image/png,image/jpeg,image/webp"
					aria-label="选择对照图片"
					disabled={busy}
					className="block w-full text-xs"
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void selectImage({ file });
					}}
				/>
			</label>
			<div className="flex items-center gap-2 text-xs">
				<span className="min-w-0 flex-1 break-words">
					{input.name} · {input.width} × {input.height}
					{input.resized ? "（已等比缩小）" : ""}
				</span>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => {
						setInput(comparisonTestImage());
						setResult(undefined);
						setError("");
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") event.currentTarget.blur();
					}}
				>
					使用测试图
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				支持不透明 SDR 图片，长边最多 640
				像素；较大图片自动等比缩小。需要本机已缓存的迷雾 LUT。
			</p>
			<label className="block space-y-1 text-xs">
				<span>强度 {intensity}%</span>
				<input
					type="range"
					aria-label="对照强度"
					min={0}
					max={100}
					step={1}
					value={intensity}
					disabled={busy}
					className="w-full"
					onChange={(event) => {
						setIntensity(Number(event.target.value));
						setResult(undefined);
					}}
				/>
			</label>
			<Button
				type="button"
				className="w-full"
				disabled={!supported || busy}
				onClick={() => void compare()}
				onKeyDown={(event) => {
					if (event.key === "Escape") event.currentTarget.blur();
				}}
			>
				{busy ? "正在处理…" : "运行同图对照"}
			</Button>
			{error && (
				<p role="alert" className="break-words text-xs text-destructive">
					{error}
				</p>
			)}
			{result && (
				<FilterComparisonResults result={result} inputName={input.name} />
			)}
		</section>
	);
}
