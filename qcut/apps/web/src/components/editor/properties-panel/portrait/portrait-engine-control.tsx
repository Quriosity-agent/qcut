import { useEffect, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	type IndependentPortraitIssue,
	independentPortraitRequest,
} from "@/lib/portrait/independent-portrait-adjustments";
import type {
	BeautyLabIndependentStatus,
	JianyingPortraitAdjustmentStatus,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";

const SCOPE_LABELS = {
	faces: { zh: "单人或分人物设置", en: "per-person settings" },
	"manual-retouch": { zh: "手动精修", en: "manual retouch" },
	"manual-body": { zh: "手动美体", en: "manual body" },
} as const;

function issueText({
	issue,
	nativeStatus,
	isZh,
}: {
	issue: IndependentPortraitIssue;
	nativeStatus: JianyingPortraitAdjustmentStatus | null;
	isZh: boolean;
}) {
	if (issue.code === "scope") {
		const names = issue.selections.map((selection) =>
			isZh ? SCOPE_LABELS[selection].zh : SCOPE_LABELS[selection].en
		);
		return isZh
			? `自研只对全部人脸统一处理，请清除：${names.join("、")}`
			: `Independent processes all faces alike; clear: ${names.join(", ")}`;
	}
	const names = issue.selections.map((selection) => {
		const named =
			nativeStatus?.catalog.find((control) => control.key === selection) ??
			nativeStatus?.makeupCards.find((card) => card.id === selection);
		if (!named) return selection;
		return isZh ? named.titleZh : named.titleEn;
	});
	return isZh
		? `自研不支持：${names.join("、")}。预览和导出会报错，不会改用原生。`
		: `Not supported by independent: ${names.join(", ")}. Preview and export fail instead of using native.`;
}

/**
 * Chooses which engine processes the clip's portrait edits. Independent
 * runs without the native runtime but needs seconds per frame, so the
 * panel says what that means for playback and export, and lists edits the
 * engine cannot run instead of quietly rendering them natively.
 */
export function PortraitEngineControl({
	adjustments,
	nativeStatus,
	disabled,
	locale,
	onChange,
}: {
	adjustments: MediaPortraitAdjustments;
	nativeStatus: JianyingPortraitAdjustmentStatus | null;
	disabled: boolean;
	locale: string;
	onChange: (adjustments: MediaPortraitAdjustments) => void;
}) {
	const isZh = locale === "zh";
	const independent = adjustments.engine === "independent";
	const [status, setStatus] = useState<BeautyLabIndependentStatus | null>(null);
	const [statusError, setStatusError] = useState<string | null>(null);
	useEffect(() => {
		if (!independent) return;
		let active = true;
		const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
		if (!inspect) {
			setStatusError(isZh ? "需要 QCut 桌面版" : "Requires QCut Desktop");
			return;
		}
		void inspect()
			.then((next) => {
				if (!active) return;
				setStatus(next);
				setStatusError(null);
			})
			.catch((error: unknown) => {
				if (active) setStatusError(String(error));
			});
		return () => {
			active = false;
		};
	}, [independent, isZh]);
	const converted =
		independent && status?.available
			? independentPortraitRequest({ adjustments, support: status })
			: null;
	const issue = converted && "issue" in converted ? converted.issue : null;
	const runtimeMessage = statusError
		? statusError
		: status
			? status.available
				? null
				: status.message
			: isZh
				? "正在检查自研引擎…"
				: "Checking independent engine…";

	return (
		<div className="space-y-2" data-testid="portrait-engine-control">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs">{isZh ? "处理引擎" : "Engine"}</span>
				<Select
					value={independent ? "independent" : "native"}
					disabled={disabled}
					onValueChange={(next) => {
						const { engine: _engine, ...rest } = adjustments;
						onChange(
							next === "independent" ? { ...rest, engine: "independent" } : rest
						);
					}}
				>
					<SelectTrigger
						className="h-8 w-32 text-xs"
						aria-label={isZh ? "美颜处理引擎" : "Portrait engine"}
						data-testid="portrait-engine-select"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="native">{isZh ? "原生" : "Native"}</SelectItem>
						<SelectItem value="independent">
							{isZh ? "自研" : "Independent"}
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{independent ? (
				<div className="space-y-1 rounded-sm border border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
					<p data-testid="portrait-engine-note">
						{isZh
							? "每帧约 3–12 秒，参数越多越慢：播放时显示原画面，暂停后显示处理结果；导出逐帧处理，已处理的帧会缓存，重复导出直接复用。处理分辨率最长边 1280；竖屏 9:16 画面暂不支持磨皮和美白。"
							: "About 3–12 s a frame, slower with more edits: playback shows the original and a paused frame shows the result; export processes every frame and reuses cached frames. Processed at up to 1280 px on the long edge; smoothing and whitening do not support 9:16 vertical frames yet."}
					</p>
					{runtimeMessage ? (
						<p
							className="text-amber-600 dark:text-amber-400"
							data-testid="portrait-engine-runtime"
						>
							{runtimeMessage}
						</p>
					) : null}
					{issue ? (
						<p
							className="text-amber-600 dark:text-amber-400"
							data-testid="portrait-engine-issue"
						>
							{issueText({ issue, nativeStatus, isZh })}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
