import {
	Download,
	FlaskConical,
	ImagePlus,
	Loader2,
	Play,
	RotateCcw,
	Scan,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useTranslation } from "@/lib/i18n";
import { beautyLabCatalogStatus } from "@/lib/portrait/beauty-lab-catalog";
import { exportBeautyLabComparison } from "@/lib/portrait/beauty-lab-export";
import { useBeautyLab } from "@/lib/portrait/use-beauty-lab";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { BeautyLabControls } from "./beauty-lab-controls";
import { BeautyLabResults } from "./beauty-lab-results";

interface BeautyLabProps {
	elementId: string;
	currentFrame: number;
	initialAdjustments: MediaPortraitAdjustments;
}

const RESEARCH_CASE_NAMES: Record<string, string> = {
	temporal: "人脸时序对照",
	"qcut-export": "QCut 导出对照",
	"owned-preprocess": "自有采样对照",
};

function BeautyLabWorkspace(props: BeautyLabProps) {
	const { locale } = useTranslation();
	const isZh = locale.startsWith("zh");
	const lab = useBeautyLab(props);
	const fileRef = useRef<HTMLInputElement>(null);
	const [gain, setGain] = useState(8);
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);
	const disabled = Boolean(lab.busy || exporting);
	const catalogStatus = beautyLabCatalogStatus({
		status: lab.status,
		recordedValues: lab.record ? lab.adjustments.values : undefined,
	});

	async function download() {
		if (!lab.input) return;
		setExporting(true);
		setExportError(null);
		try {
			const blob = await exportBeautyLabComparison({
				input: lab.input,
				native: lab.native,
				candidate: lab.candidate,
				gain,
				adjustments: lab.adjustments,
				record: lab.record,
				candidateReport: lab.candidateReport,
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = "qcut-beauty-lab-comparison.zip";
			anchor.click();
			window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
		} catch (reason) {
			setExportError(String(reason));
		} finally {
			setExporting(false);
		}
	}

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			data-testid="beauty-lab-workspace"
		>
			<div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={disabled}
					onClick={() => fileRef.current?.click()}
				>
					<ImagePlus size={16} />
					{isZh ? "导入图片" : "Import image"}
				</Button>
				<input
					ref={fileRef}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					className="hidden"
					aria-label={isZh ? "实验室图片" : "Lab image"}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void lab.importImage({ file });
					}}
				/>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={disabled}
					onClick={lab.captureFrame}
				>
					<Scan size={16} />
					{isZh ? "当前原始帧" : "Current source frame"}
				</Button>
				<Select
					value={lab.record?.caseId ?? "live"}
					disabled={disabled}
					onValueChange={(caseId) =>
						caseId === "live"
							? lab.leaveRecord()
							: void lab.loadRecord({ caseId, frameIndex: 0 })
					}
				>
					<SelectTrigger
						className="h-8 w-[min(100%,230px)]"
						aria-label={isZh ? "对照来源" : "Comparison source"}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="z-[1100]">
						<SelectItem value="live">
							{isZh ? "当前输入" : "Current input"}
						</SelectItem>
						{lab.cases.map((item) => (
							<SelectItem key={item.id} value={item.id}>
								{isZh ? (RESEARCH_CASE_NAMES[item.id] ?? item.name) : item.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{lab.record && (
					<Select
						value={String(lab.record.frameIndex)}
						disabled={disabled}
						onValueChange={(value) => {
							if (lab.record)
								void lab.loadRecord({
									caseId: lab.record.caseId,
									frameIndex: Number(value),
								});
						}}
					>
						<SelectTrigger
							className="h-8 w-24"
							aria-label={isZh ? "记录帧" : "Recorded frame"}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="z-[1100]">
							{Array.from({ length: 7 }, (_, index) => (
								<SelectItem key={index} value={String(index)}>
									{isZh ? "帧" : "Frame"} {index}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<Button
					type="button"
					size="icon"
					variant="text"
					disabled={disabled}
					title={isZh ? "清空对照" : "Clear comparison"}
					aria-label={isZh ? "清空对照" : "Clear comparison"}
					onClick={lab.leaveRecord}
				>
					<RotateCcw size={16} />
				</Button>
				<div className="flex flex-wrap items-center gap-2 sm:ml-auto">
					<Button
						type="button"
						size="sm"
						disabled={
							disabled ||
							!lab.input ||
							Boolean(lab.record) ||
							!lab.status?.available
						}
						onClick={() => void lab.renderNative()}
					>
						{lab.busy === "render" ? (
							<Loader2 size={16} className="animate-spin" />
						) : (
							<Play size={16} />
						)}
						{isZh ? "原生处理" : "Render native"}
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={
							disabled ||
							!lab.input ||
							Boolean(lab.record) ||
							!lab.candidateStatus?.available
						}
						title={lab.candidateStatus?.blockers.join(", ")}
						onKeyDown={(event) => event.stopPropagation()}
						onClick={() => void lab.renderCandidate()}
					>
						{lab.busy === "candidate" ? (
							<Loader2 size={16} className="animate-spin" />
						) : (
							<FlaskConical size={16} />
						)}
						{isZh ? "候选处理" : "Render candidate"}
					</Button>
					<Button
						type="button"
						size="icon"
						variant="outline"
						disabled={disabled || !lab.input}
						title={isZh ? "导出对照 ZIP" : "Export comparison ZIP"}
						aria-label={isZh ? "导出对照 ZIP" : "Export comparison ZIP"}
						onClick={() => void download()}
					>
						{exporting ? (
							<Loader2 size={16} className="animate-spin" />
						) : (
							<Download size={16} />
						)}
					</Button>
				</div>
			</div>
			<div
				className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground"
				role="status"
				aria-label={isZh ? "实验室状态" : "Lab status"}
			>
				<span>
					{lab.record
						? isZh
							? "已验收离线记录 · 参数锁定"
							: "Verified offline record · parameters locked"
						: lab.status?.available
							? isZh
								? "原生运行时就绪"
								: "Native runtime ready"
							: isZh
								? "原生运行时未就绪"
								: "Native runtime unavailable"}
				</span>
				<span>
					{lab.record
						? isZh
							? "新链路：离线回放，仍含原生依赖"
							: "Candidate: offline replay, native dependencies remain"
						: lab.candidateStatus?.available
							? isZh
								? "新链路：候选后端就绪"
								: "Candidate: backend ready"
							: isZh
								? "新链路：任意画面推理未接入"
								: "Candidate: arbitrary-frame inference not connected"}
				</span>
				{lab.input && (
					<span>
						{lab.input.name} · {lab.input.width} × {lab.input.height}
					</span>
				)}
				{lab.record && (
					<span className="font-mono">
						face_adjust_eye intensity=
						{(lab.adjustments.values.face_adjust_eye ?? 0) / 100}
					</span>
				)}
				{lab.busy && (
					<Loader2
						size={14}
						className="animate-spin"
						aria-label={isZh ? "处理中" : "Processing"}
					/>
				)}
			</div>
			{(lab.error || exportError) && (
				<p
					role="alert"
					className="break-words border-b px-4 py-2 text-xs text-destructive"
				>
					{lab.error || exportError}
				</p>
			)}
			<div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[350px_minmax(0,1fr)] lg:overflow-hidden">
				<aside className="min-w-0 border-b p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
					<BeautyLabControls
						status={catalogStatus}
						adjustments={lab.adjustments}
						locale={locale}
						disabled={disabled}
						readOnly={Boolean(lab.record)}
						faces={lab.faces}
						detecting={lab.busy === "detect"}
						canDetect={Boolean(
							lab.input && lab.status?.available && !lab.record
						)}
						onChange={lab.changeAdjustments}
						onDetect={() => void lab.detectFaces()}
					/>
				</aside>
				<section
					className="min-w-0 space-y-4 p-4 lg:overflow-y-auto"
					aria-label={isZh ? "美颜对照" : "Beauty comparison"}
				>
					<div className="flex items-center gap-3 text-xs">
						<label htmlFor="beauty-lab-gain" className="shrink-0">
							{isZh ? "差分增益" : "Difference gain"}
						</label>
						<Slider
							id="beauty-lab-gain"
							aria-label={isZh ? "统一差分增益" : "Shared difference gain"}
							className="max-w-48"
							min={1}
							max={32}
							step={1}
							value={[gain]}
							onValueChange={([value]) => setGain(value)}
						/>
						<output className="w-10 shrink-0 tabular-nums">×{gain}</output>
					</div>
					<BeautyLabResults
						input={lab.input}
						native={lab.native}
						candidate={lab.candidate}
						gain={gain}
						locale={locale}
						nativeLabel={
							isZh
								? lab.record
									? "原生基准（记录）"
									: "原生结果"
								: lab.record
									? "Native baseline (recorded)"
									: "Native result"
						}
						candidateLabel={
							isZh
								? lab.record
									? "新链路（离线回放）"
									: lab.candidateReport
										? "新链路（实时候选）"
										: "新链路（未接入）"
								: lab.record
									? "Candidate (offline replay)"
									: lab.candidateReport
										? "Candidate (live)"
										: "Candidate (not connected)"
						}
					/>
				</section>
			</div>
		</div>
	);
}

export function BeautyLabDialog(props: BeautyLabProps) {
	const { locale } = useTranslation();
	const [open, setOpen] = useState(false);
	const title = locale.startsWith("zh") ? "美颜实验室" : "Beauty Lab";
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="w-full"
					data-testid="beauty-lab-open"
				>
					<FlaskConical size={16} />
					{title}
				</Button>
			</DialogTrigger>
			<DialogContent
				scrollable={false}
				overlayClassName="z-[1000]"
				aria-describedby={undefined}
				onKeyDown={(event) => event.stopPropagation()}
				className="z-[1001] flex h-[92dvh] max-w-[1480px] flex-col gap-0 overflow-hidden rounded-md p-0"
				data-testid="beauty-lab-dialog"
			>
				<header className="border-b px-4 py-3 pr-12">
					<DialogTitle className="text-base">{title}</DialogTitle>
				</header>
				{open && <BeautyLabWorkspace {...props} />}
			</DialogContent>
		</Dialog>
	);
}
