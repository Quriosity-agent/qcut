import type { BeautyMatrixRow } from "./beauty-lab-matrix";

function escapeHtml({ value }: { value: string }) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
export function beautyMatrixGallery({
	rows,
	summary,
}: {
	rows: BeautyMatrixRow[];
	summary: Record<string, number>;
}) {
	const cards = rows
		.map((row) => {
			const safeId = escapeHtml({ value: row.id });
			const status = row.error
				? "出图失败"
				: row.parity?.withinOneRGB
					? "RGB 最大差 ≤1"
					: "存在偏差";
			return `<article data-state="${row.error ? "error" : row.parity?.withinOneRGB ? "pass" : "difference"}"><h2>${safeId}</h2><p>${status} · 最大差 ${row.parity?.maximumRGB ?? "—"} · MAE ${row.parity?.meanRGB.toFixed(4) ?? "—"}</p><div class="images">${[
				["原图", `${row.inputId}-original.png`],
				["原生", `${row.id}/native.png`],
				["自研", `${row.id}/independent.png`],
				["差异 ×8", `${row.id}/difference-x8.png`],
			]
				.map(
					([title, image]) =>
						`<figure><img loading="lazy" src="${escapeHtml({ value: image })}" alt="${title}"><figcaption>${title}</figcaption></figure>`
				)
				.join(
					""
				)}</div>${row.error ? `<pre>${escapeHtml({ value: row.error })}</pre>` : ""}<p>自研对原图变化像素 ${row.ownedChange?.changedPixels ?? "—"} · 原生 ${row.nativeChange?.changedPixels ?? "—"}</p><a href="${safeId}/case.json">参数与记录</a></article>`;
		})
		.join("");
	return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty Lab 大规模对照</title><style>body{font:16px system-ui;background:#12131a;color:#eaeaf0;margin:24px}h1{font-size:28px}article{background:#222431;padding:18px;margin:16px 0;border-radius:12px}h2{font-size:18px}.images{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0}img{width:100%;max-height:360px;object-fit:contain;background:#111}figcaption{padding:8px}pre{white-space:pre-wrap;color:#ffb0b0}a{color:#a5c6ff}select{padding:8px;background:#222431;color:white}article[data-state=error]{border:1px solid #ff7777}@media(max-width:800px){.images{grid-template-columns:repeat(2,1fr)}}</style><h1>原生／自研图片矩阵</h1><p>已完成 ${summary.completed}/${summary.planned} · 两路出图 ${summary.executed} · 最大 RGB 差 ≤1：${summary.withinOneRGB} · 超阈值 ${summary.outsideOneRGB} · 出图失败 ${summary.renderErrors}</p><p>每项记录真实 provider 输出。≤1 只表示当前案例接近，未宣称产品全量一致；合成脸型样本标签为视觉假设，逐帧测试不证明视频时序。</p><label for="filter">筛选</label> <select id="filter"><option value="all">全部</option><option value="difference">存在偏差</option><option value="error">出图失败</option><option value="pass">RGB 最大差 ≤1</option></select>${cards}<script>document.getElementById('filter').addEventListener('change',event=>{for(const article of document.querySelectorAll('article'))article.hidden=event.target.value!=='all'&&article.dataset.state!==event.target.value})</script></html>`;
}
