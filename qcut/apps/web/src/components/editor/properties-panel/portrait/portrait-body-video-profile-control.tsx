import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { BeautyLabIndependentStatus } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";

export function PortraitBodyVideoProfileControl({
	adjustments,
	status,
	error,
	locale,
	onChange,
}: {
	adjustments: MediaPortraitAdjustments;
	status: BeautyLabIndependentStatus | null;
	error: string | null;
	locale: string;
	onChange: (adjustments: MediaPortraitAdjustments) => void;
}) {
	const isZh = locale === "zh";
	const selected = adjustments.bodyVideoProfile === "swing-coreml-v1";
	const profile = status?.bodyVideoProfiles?.["swing-coreml-v1"];
	const available =
		!error &&
		status?.available === true &&
		status.bodyVideo === true &&
		profile?.available === true;
	const unavailableMessage =
		error ??
		(status
			? status.available
				? status.bodyVideo !== true
					? isZh
						? "当前引擎不支持视频美体序列"
						: "This engine does not support body video sequences"
					: (profile?.message ??
						(isZh
							? "当前引擎未配置 CoreML 视频美体"
							: "CoreML body video is not configured for this engine"))
				: status.message
			: isZh
				? "正在检查 CoreML…"
				: "Checking CoreML…");

	return (
		<div
			className="space-y-2"
			data-testid="portrait-body-video-profile-control"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs">{isZh ? "美体视频" : "Body video"}</span>
				<Select
					value={selected ? "swing-coreml-v1" : "cpu"}
					onValueChange={(value) => {
						if (value === "swing-coreml-v1" && !available) return;
						const { bodyVideoProfile: _profile, ...rest } = adjustments;
						onChange(
							value === "swing-coreml-v1"
								? { ...rest, bodyVideoProfile: "swing-coreml-v1" }
								: rest
						);
					}}
				>
					<SelectTrigger
						className="h-8 w-44 text-xs"
						aria-label={isZh ? "美体视频计算方式" : "Body video processing"}
						data-testid="portrait-body-video-profile-select"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="cpu">
							{isZh ? "CPU 稳定" : "CPU stable"}
						</SelectItem>
						<SelectItem value="swing-coreml-v1" disabled={!available}>
							{isZh ? "原生调度 CoreML" : "Native scheduling CoreML"}
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{available ? (
				selected ? (
					<p
						className="text-[11px] text-muted-foreground"
						data-testid="portrait-body-video-profile-status"
					>
						{isZh
							? "首次初始化期间使用 CPU，准备就绪后启用 CoreML。预览和导出复用同一处理历史。"
							: "CPU handles initialization; CoreML takes over when ready. Preview and export reuse the same processing history."}
					</p>
				) : null
			) : (
				<p
					className="text-[11px] text-amber-600 dark:text-amber-400"
					data-testid="portrait-body-video-profile-status"
					role={selected ? "alert" : "status"}
				>
					{unavailableMessage}
					{selected
						? isZh
							? "。已保存的 CoreML 选择保持不变；美体预览和导出不可用，请配置环境或手动选择 CPU。"
							: ". Your saved CoreML selection is retained. Body preview and export are unavailable; configure the runtime or select CPU."
						: null}
				</p>
			)}
		</div>
	);
}
