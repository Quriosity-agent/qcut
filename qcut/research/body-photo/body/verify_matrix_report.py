"""Offline, escaped Chinese photo-matrix gallery; no external image or script assets."""
from html import escape
import json


STATUS = {"applied": "实际已应用", "partial": "部分生效", "unavailable": "未应用，输出为原图", "identity": "归零，与原图一致", "error": "请求或结果错误"}
VERDICT = {"passed": "符合声明期望", "expected-partial": "符合部分生效边界", "expected-unavailable": "符合不可用边界", "failed": "验收失败", "unverified": "待人工确认，不计通过"}
KINDS = {"real-video-frame": "真人视频帧", "real-photo": "真人照片", "synthetic-reference": "合成人像样本",
         "blank-negative": "构造空图／无人物负例", "constructed-negative": "构造负例", "unknown": "来源类别未声明"}


def text(value):
    return escape(str(value), quote=True)


def case_html(*, entry, case, titles):
    key = entry["id"] + "--" + case["id"]
    source = entry["id"] + "/" + entry.get("sourceFile", "source.png")
    verified = case.get("evidenceChecksPassed") is True
    result = entry["id"] + "/" + case.get("resultFile", "")
    expected = case.get("expectation")
    expectation = STATUS.get(expected["status"], expected["status"]) if expected else "未声明；本例只作观察"
    detail = case.get("error", {}).get("message") or case.get("message", "")
    controls = "".join(f'<li>{text(titles.get(name, name))} {text(value.get("requested", ""))}：'
        f'{"" if verified else "服务声明（未核验）"}{"已生效" if value.get("applied") else "未生效"} · {text(value.get("message", ""))}</li>'
        for name, value in case.get("controls", {}).items() if isinstance(value, dict))
    parameters = " / ".join(f"{titles.get(name, name)} {value}" for name, value in case["values"].items())
    if verified:
        actual_label = "实际输出 · 保留原图" if case["status"] in ("identity", "unavailable") else "实际结果"
        picture = f'''<div class="compare"><img src="{text(source)}" alt="归一化原图" loading="lazy" draggable="false" />
<div class="result"><img src="{text(result)}" alt="本次实际输出" loading="lazy" draggable="false" /></div>
<span class="before">原图</span><span class="after">{text(actual_label)}</span><div class="line" aria-hidden="true"></div></div>
<div class="wipe"><label for="{text(key)}">对比位置</label><input id="{text(key)}" type="range" min="0" max="100" step="1" value="50" aria-label="{text(entry.get('label',entry['id']))} {text(case['title'])}分界位置" /><output for="{text(key)}">50%</output></div>
<p class="links"><a href="{text(result)}">实际输出 PNG</a><a href="{text(entry['id'] + '/' + case['halfFile'])}">固定半图 PNG</a><a href="{text(entry['id'] + '/' + case['id'] + '-check.json')}">本例核验 JSON</a></p>'''
    else:
        picture = '<div class="no-result">此项未通过图像与交付核验，不展示未经验证的结果。</div>'
    return f'''<article class="case" data-verdict="{text(case['verdict'])}" data-status="{text(case['status'])}">
<div class="case-heading"><h3>{text(case['title'])}</h3><span class="badge">{text(STATUS.get(case['status'],case['status']))}</span></div>
<p class="parameters">{text(parameters)}</p><p class="verdict">{text(VERDICT.get(case['verdict'],case['verdict']))} · 期望：{text(expectation)}</p>
{picture}<p>{text(detail)}</p><p class="assessment">{text(case.get('assessment',''))}</p><ul>{controls}</ul>
<p class="metrics">{text(case.get('changedPixels','未确认'))} 个像素变化 · {text(case.get('milliseconds','—'))} ms · 自然度尚需人工检查</p></article>'''


def write_gallery(*, report, output):
    summary = report["summary"]
    titles = {control["name"]: control.get("title", control["name"])
              for control in report.get("catalog", {}).get("controls", [])}
    sections = []
    for entry in report["entries"]:
        errors = "".join(f'<p class="error">{text(item["message"])}</p>' for item in entry["errors"])
        cards = "".join(case_html(entry=entry, case=case, titles=titles) for case in entry["cases"])
        provenance = entry.get("provenance", {})
        provenance = json.dumps(provenance, ensure_ascii=False, indent=2) if isinstance(provenance, dict) else provenance
        sections.append(f'''<section class="entry"><h2>{text(entry['label'])} <small>{text(entry['id'])}</small></h2>
<p>{text(KINDS.get(entry['sourceKind'],entry['sourceKind']))} · 清单人物ID：{text(entry.get('subjectId') or '未声明，不能推断不同人物数')}</p>
<p>{text(entry.get('notes',''))}</p><p class="source">来源记录：{text(entry.get('source') or '未填写')}</p>
<details><summary>来源与构造说明</summary><pre>{text(provenance or '未填写')}</pre></details>{errors}<div class="grid">{cards}</div></section>''')
    errors = "".join(f'<p class="error">{text(item["message"])}</p>' for item in report["errors"])
    overview = "全部声明与交付检查符合" if report["allChecksPassed"] else "含失败或待确认项目，不能宣称全量可用"
    counts = " · ".join(f"{STATUS.get(key,key)} {value}" for key, value in summary["actualStatuses"].items())
    html = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>独立美体 · 图片矩阵验收</title><link rel="icon" href="data:," /><style>{STYLE}</style></head><body><main>
<header><p class="eyebrow">独立美体 · 静态图片矩阵</p><h1>逐张检查，逐项说明</h1><p class="overview">{text(overview)}</p>
<p>{text(summary['photosProcessed'])} / {text(summary['photosRequested'])} 张照片 · {text(summary['renderRequestAttempts'])} 次渲染请求尝试 · {text(summary['evidenceChecksPassed'])} 项交付证据通过</p>
<p>{text(counts)}</p><p>缺少期望：{text(summary['missingExpectations'])} 项。部分生效、不可用边界与实际美体成功分别记录；不能将“未识别、输出原图”算作成功美体。</p>
<p>本页按输入照片计数；同一人的多帧不是不同人物，合成与构造样本不计作真人代表性验证。</p>
<p>左原图、右实际输出，拖动分界查看同一位置。自然左右不对称会影响观感；数值证据不代表自然度或原生像素一致。</p>
<p><a href="acceptance.json">完整验收 JSON</a><a href="manifest.json">原始输入清单</a><a href="manifest-normalized.json">规范化运行清单</a></p>{errors}</header>
<div class="filters"><label for="filter">筛选</label><select id="filter"><option value="all">全部项目</option><option value="applied">已应用</option><option value="failed">验收失败</option><option value="unverified">待人工确认</option><option value="partial">部分生效</option><option value="unavailable">未应用</option></select></div>
{''.join(sections)}<footer>页面、图片、脚本均为本地文件，离线可用。半图由原图与实际输出直接拼接，未合成或增强效果。</footer></main><script>{SCRIPT}</script></body></html>'''
    (output / "index.html").write_text(html, encoding="utf-8")


STYLE = '''
pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#acc3b3;font-size:11px;line-height:1.7}details{margin:12px 0 18px}summary{font-size:12px;color:#b3cdbb;cursor:pointer}
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#0c1417;color:#e5eee8}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:34px 25px}h1{font-size:32px;font-weight:500;margin:10px 0}h2{font-weight:500;font-size:23px;margin:35px 0 10px}small{font-size:13px;color:#9ab2a5}p,li{font-size:13px;line-height:1.8;color:#a7bdb2}.eyebrow{color:#a6e0c3;letter-spacing:.12em;font-size:12px}.overview{font-size:19px;color:#cee7da}header{border-bottom:1px solid #345047;padding-bottom:20px}a{color:#b5e9ce;margin-right:18px;font-size:12px}.filters{display:flex;align-items:center;gap:12px;margin:23px 0;font-size:13px}select{font:inherit;padding:8px 12px;background:#182c27;color:#d0eadb;border:1px solid #3e6052;border-radius:6px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.case{padding:17px;border:1px solid #2c483c;border-radius:10px;background:#13221e;min-width:0}.case-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.case h3{font-size:16px;font-weight:500;margin:0}.badge{font-size:11px;border:1px solid #4f6c58;border-radius:15px;padding:5px 9px;white-space:nowrap;color:#bce5cc}.parameters{font-size:11px;color:#a6bdb0}.verdict{font-size:11px;color:#bbd4c4}.compare{height:500px;position:relative;background:#080f11;overflow:hidden;border-radius:6px;isolation:isolate}.compare img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center}.result{position:absolute;inset:0;clip-path:inset(0 0 0 50%)}.before,.after{position:absolute;top:12px;padding:5px 9px;background:#0a1815d9;color:#e0eee5;font-size:11px;border-radius:4px;pointer-events:none}.before{left:12px}.after{right:12px}.line{position:absolute;top:0;bottom:0;left:50%;width:1px;background:#deeee6;pointer-events:none}.wipe{display:flex;align-items:center;gap:12px;margin:15px 0;font-size:11px;color:#aec6b7}.wipe input{width:100%;accent-color:#b4e7cb}.wipe output{min-width:30px;text-align:right;font-variant-numeric:tabular-nums}.wipe label{white-space:nowrap}.links a{font-size:10px;margin-right:12px}.assessment,.metrics,.source{font-size:11px;color:#99b09f;overflow-wrap:anywhere}.case ul{padding-left:19px}.case li{font-size:11px}.case[data-verdict="failed"]{border-color:#af6e55}.case[data-verdict="unverified"]{border-color:#87754d}.case[data-status="unavailable"] .badge,.case[data-status="partial"] .badge{color:#ecd29b;border-color:#887348}.error{color:#f3ba9d;background:#35221a;padding:13px;border-radius:5px;overflow-wrap:anywhere}.no-result{padding:70px 22px;text-align:center;background:#241a16;color:#dfb4a0;font-size:13px;line-height:1.8}.case[hidden]{display:none}footer{font-size:12px;color:#9ab3a3;margin-top:35px;line-height:1.8}@media(max-width:850px){main{padding:25px 15px}.grid{grid-template-columns:1fr}.compare{height:65vh;min-height:350px}.case-heading{flex-wrap:wrap}.case{padding:13px}h1{font-size:28px}}'''

SCRIPT = '''
for (const card of document.querySelectorAll('.case')) {
 const slider = card.querySelector('input[type="range"]');
 if (!slider) continue;
 slider.addEventListener('input', () => {
  const value = Math.max(0, Math.min(100, Number(slider.value)));
  card.querySelector('.result').style.clipPath = `inset(0 0 0 ${value}%)`;
  card.querySelector('.line').style.left = `${value}%`;
  card.querySelector('output').textContent = `${value}%`;
 });
}
document.getElementById('filter').addEventListener('change', event => {
 const choice = event.target.value;
 for (const card of document.querySelectorAll('.case')) {
  card.hidden = choice !== 'all' && card.dataset.verdict !== choice && card.dataset.status !== choice;
 }
 for (const entry of document.querySelectorAll('.entry')) {
  entry.hidden = !entry.querySelector('.case:not([hidden]), .error');
 }
});'''
