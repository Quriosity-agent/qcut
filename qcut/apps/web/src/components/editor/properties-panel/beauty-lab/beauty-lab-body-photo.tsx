import { ExternalLink, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBodyPhotoLab } from "@/lib/portrait/use-body-photo-lab";

export function BeautyLabBodyPhoto({
	locale,
	disabled,
}: {
	locale: string;
	disabled: boolean;
}) {
	const isZh = locale.startsWith("zh");
	const photo = useBodyPhotoLab();
	const busy = Boolean(photo.pending);
	const unavailable = !photo.status?.available;
	return (
		<section
			className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-3"
			aria-label={isZh ? "独立照片美体" : "Independent photo body"}
			data-testid="beauty-lab-body-photo"
		>
			<div className="min-w-48 flex-1 space-y-1 text-xs">
				<p className="font-medium">
					{isZh ? "独立照片美体（CPU）" : "Independent photo body (CPU)"}
				</p>
				<p className="text-muted-foreground">
					{isZh
						? "单张照片 · 21 项调节 · 局部编辑与臀部轮廓 · 原图对比 · PNG 导出"
						: "Single photo · 21 controls · Local edits and glute contours · Original comparison · PNG export"}
				</p>
				{!photo.desktop && (
					<p className="text-muted-foreground">
						{isZh ? "请在 QCut 桌面版中打开。" : "Open in QCut Desktop."}
					</p>
				)}
				{photo.status && unavailable && (
					<p className="text-muted-foreground">{photo.status.message}</p>
				)}
				{photo.error && <p role="alert">{photo.error}</p>}
			</div>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={disabled || busy || !photo.desktop}
				onClick={() => void photo.execute({ operation: "chooseRuntime" })}
			>
				<FolderOpen size={16} />
				{isZh ? "选择本地资源" : "Choose local resources"}
			</Button>
			<Button
				type="button"
				size="sm"
				disabled={disabled || busy || unavailable}
				onClick={() => void photo.execute({ operation: "open" })}
			>
				{busy ? (
					<Loader2 className="animate-spin" size={16} />
				) : (
					<ExternalLink size={16} />
				)}
				{isZh ? "打开照片美体" : "Open photo body"}
			</Button>
			{photo.status?.windowOpen && (
				<Button
					type="button"
					size="sm"
					variant="text"
					disabled={disabled || busy}
					onClick={() => void photo.execute({ operation: "close" })}
				>
					{isZh ? "关闭照片窗口" : "Close photo window"}
				</Button>
			)}
		</section>
	);
}
