import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/makeup-catalog";
import { Button } from "@/components/ui/button";
import { INDEPENDENT_MANUAL_BODY_LABELS } from "@/lib/portrait/independent-portrait-adjustments";
import type { useBeautyLabIndependent } from "@/lib/portrait/use-beauty-lab-independent";

type IndependentLab = ReturnType<typeof useBeautyLabIndependent>;

const MANUAL_BODY_TOOL_NAMES: Record<string, string> = {
	stretch: "拉长",
	slim: "瘦身",
	zoom: "放大缩小",
};

/** " / 手动美体拉长、瘦身…" for the manual body tools the engine renders; empty when none. */
function manualBodySummary({ tools }: { tools: string[] | undefined }) {
	const names = (tools ?? []).flatMap(
		(tool) => MANUAL_BODY_TOOL_NAMES[tool] ?? []
	);
	return names.length > 0 ? ` / 手动美体${names.join("、")}` : "";
}

function independentIssueLabel({
	lab,
	isZh,
}: {
	lab: IndependentLab;
	isZh: boolean;
}) {
	const issue = lab.issue;
	if (!issue) return undefined;
	if (issue.code === "unsupported") {
		const names = (issue.selections ?? []).map((key) => {
			const tool = INDEPENDENT_MANUAL_BODY_LABELS[key];
			if (tool) return isZh ? tool.zh : tool.en;
			const entry =
				JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
					(control) => control.key === key
				) ?? JIANYING_PORTRAIT_MAKEUP_CARDS.find((card) => card.id === key);
			return entry
				? isZh
					? entry.titleZh
					: entry.titleEn
				: isZh
					? "未识别项目"
					: "Unknown selection";
		});
		return `${isZh ? "自研暂不支持" : "Independent does not support"}: ${names.join(isZh ? "、" : ", ")}`;
	}
	if (!isZh) return issue.message;
	if (issue.code === "input") return "请导入照片后使用自研处理";
	if (issue.code === "record") return "离线记录只能查看";
	if (issue.code === "dimensions")
		return "自研照片需要有效尺寸，最长边不超过 4096，总像素不超过 8294400";
	if (issue.code === "scope")
		return "自研需选择全部人脸模式的单人照片；手动精修、美体与肤色请用原生处理";
	return issue.message;
}

export function BeautyLabIndependentActions({
	lab,
	disabled,
	isZh,
	onSelect,
}: {
	lab: IndependentLab;
	disabled: boolean;
	isZh: boolean;
	onSelect: () => void;
}) {
	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={disabled || Boolean(lab.blocker)}
				title={independentIssueLabel({ lab, isZh }) ?? lab.status?.message}
				onKeyDown={(event) => event.stopPropagation()}
				onClick={() => {
					onSelect();
					void lab.render();
				}}
			>
				{isZh ? "自研处理" : "Render independent"}
			</Button>
			{lab.job && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={lab.job.cancelling}
					onKeyDown={(event) => event.stopPropagation()}
					onClick={() => void lab.cancel()}
				>
					{lab.job.cancelling
						? isZh
							? "正在取消…"
							: "Cancelling…"
						: isZh
							? "取消自研处理"
							: "Cancel independent"}
				</Button>
			)}
		</>
	);
}

export function BeautyLabIndependentStatus({
	lab,
	isZh,
}: {
	lab: IndependentLab;
	isZh: boolean;
}) {
	return (
		<>
			<span title={lab.status?.message}>
				{lab.status?.available
					? isZh
						? `自研就绪 · ${lab.status.controls.length} 项调节 / ${lab.status.makeupCards.length} 款美妆${manualBodySummary({ tools: lab.status.manualBodyTools })} · 单人照片 ≤4096 / 829 万像素`
						: "Independent ready · single-face photos ≤4096 / 8.29 MP"
					: isZh
						? "自研未就绪"
						: "Independent unavailable"}
			</span>
			{lab.issue && <span>{independentIssueLabel({ lab, isZh })}</span>}
		</>
	);
}
