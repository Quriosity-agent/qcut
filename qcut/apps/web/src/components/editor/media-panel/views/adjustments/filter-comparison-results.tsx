import { useEffect, useState } from "react";
import type {
	FilterComparisonImage,
	FilterComparisonResult,
} from "@/types/electron";

const STAGE_LABELS: Record<string, string> = {
	"00-input": "输入",
	"01-blur-x": "横向模糊",
	"02-blur-y": "纵向模糊",
	"03-fog": "迷雾合成",
	"04-lut": "LUT 调色",
};

function ComparisonPicture({
	image,
	label,
}: {
	image: FilterComparisonImage;
	label: string;
}) {
	return (
		<figure className="min-w-0 space-y-1">
			<img
				src={image.png}
				alt={label}
				className="w-full rounded border border-border object-contain"
			/>
			<figcaption className="text-xs text-muted-foreground">{label}</figcaption>
		</figure>
	);
}

export function FilterComparisonResults({
	result,
	inputName,
}: {
	result: FilterComparisonResult;
	inputName: string;
}) {
	const [stage, setStage] = useState("04-lut");
	const selected = result.referenceStages.find(({ name }) => name === stage);
	const [report, setReport] = useState("");
	useEffect(() => {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify({ ...result, inputName }, null, 2)], {
				type: "application/json",
			})
		);
		setReport(url);
		return () => URL.revokeObjectURL(url);
	}, [result, inputName]);
	return (
		<div className="space-y-3" data-testid="filter-comparison-results">
			<p className="text-xs" role="status">
				对照完成 · {result.width} × {result.height} · 强度 {result.intensity}%
			</p>
			<div className="grid grid-cols-2 gap-2">
				<ComparisonPicture image={result.candidate} label="QCut Metal 输出" />
				<ComparisonPicture image={result.reference} label="独立 C++ 参考输出" />
				<ComparisonPicture image={result.input} label="共同输入" />
				<ComparisonPicture
					image={result.difference}
					label={`RGB 绝对差异 ×${result.differenceGain}`}
				/>
			</div>
			<dl className="grid grid-cols-2 gap-1 text-xs" aria-label="像素误差">
				<dt>RGB 平均绝对误差</dt>
				<dd>{result.metrics.rgbMae.toFixed(4)}</dd>
				<dt>RGB 均方根误差</dt>
				<dd>{result.metrics.rgbRmse.toFixed(4)}</dd>
				<dt>RGB 最大误差</dt>
				<dd>{result.metrics.rgbMax}</dd>
				<dt>Alpha 最大误差</dt>
				<dd>{result.metrics.alphaMax}</dd>
				<dt>不同像素</dt>
				<dd>
					{result.metrics.changedPixels} / {result.metrics.pixelCount}
				</dd>
			</dl>
			<p className="text-xs text-muted-foreground">
				误差单位为 0–255 色阶。这里比较 QCut 的两种实现，不代表与剪映画面一致。
			</p>
			<label className="block space-y-1 text-xs">
				<span>C++ 计算阶段</span>
				<select
					aria-label="C++ 计算阶段"
					value={stage}
					onChange={(event) => setStage(event.target.value)}
					className="w-full rounded border border-border bg-background p-1"
				>
					{result.referenceStages.map(({ name }) => (
						<option key={name} value={name}>
							{STAGE_LABELS[name] ?? name}
						</option>
					))}
				</select>
			</label>
			{selected && (
				<ComparisonPicture
					image={selected}
					label={`C++：${STAGE_LABELS[selected.name] ?? selected.name}`}
				/>
			)}
			<p className="text-xs text-muted-foreground">
				阶段图仅来自 C++；当前没有采集 Metal 中间阶段。
			</p>
			<a
				className="inline-block rounded border border-border px-3 py-1.5 text-xs underline"
				download="qcut-fog-comparison.json"
				href={report}
			>
				下载对照报告（含图片）
			</a>
		</div>
	);
}
