"""Recompute all-frame CoreML editor evidence from saved PNGs and worker receipts."""
import argparse
import hashlib
import html
import importlib.util
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

PASSES = ('original', 'native', 'independent')
PAIRS = {'original_native': ('original', 'native'),
         'original_independent': ('original', 'independent'),
         'native_independent': ('native', 'independent')}


def file_sha(*, path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_rgba(*, path, width, height, expected=None):
    with Image.open(path) as source:
        pixels = np.array(source.convert('RGBA'), dtype=np.uint8)
    if pixels.shape != (height, width, 4):
        raise ValueError(f'PNG dimensions differ: {path}')
    if expected is not None and hashlib.sha256(pixels.tobytes()).hexdigest() != expected:
        raise ValueError(f'PNG RGBA differs from recorded SHA-256: {path}')
    return pixels


def verify_execution(*, path, count):
    record = json.loads(path.read_text())
    if record.get('referenceRoutesInjected') is not False:
        raise ValueError('execution evidence must explicitly exclude injected reference routes')
    executions = record.get('executions', [])
    frames, identities, coreml = {}, {}, 0
    observed_routes = {}
    for entry in executions:
        source = Path(entry['file'])
        if file_sha(path=source) != entry['sha256']:
            raise ValueError('saved worker report hash mismatch')
        report = json.loads(source.read_text())
        body = next(row['receipt'] for row in report['stages'] if row['script'] == 'body_smart_render.py')
        identity = body['executionIdentity']
        sequence = entry['sequence']
        if (identity['profile'] != 'swing-coreml-v1' or sequence['executionProfile'] != identity['profile']
                or identity['generation'] != sequence['executionGeneration']
                or sequence['session'] != identity['generation']):
            raise ValueError('worker request, body receipt and generation disagree')
        if body['executionRoutes'] != entry['routes']:
            raise ValueError('saved worker routes disagree')
        if body['frame'] != entry['frame'] or sequence['frame'] != entry['frame']:
            raise ValueError('request frame differs from executed frame')
        prior = identities.setdefault(identity['generation'], identity)
        if prior != identity:
            raise ValueError('one execution generation changed identity')
        frames.setdefault(identity['generation'], set()).add(entry['frame'])
        key = (identity['generation'], entry['frame'])
        prior_routes = observed_routes.setdefault(key, body['executionRoutes'])
        if prior_routes != body['executionRoutes']:
            raise ValueError('one generation/frame changed its routes')
        coreml += sum(route['backend'] == 'coreml' for route in body['executionRoutes'])
    complete = {key for key, indices in frames.items() if set(range(count)) <= indices}
    if not complete or coreml == 0:
        raise ValueError('actual CoreML execution does not cover the sequence')
    journal_complete = set()
    for journal in record['journals']:
        if file_sha(path=Path(journal['file'])) != journal['sha256']:
            raise ValueError('saved route journal hash mismatch')
        stored = json.loads(Path(journal['file']).read_text())
        if stored['identity'] != identities[stored['session']] or stored['frames'] != journal['frames']:
            raise ValueError('journal differs from executed body identity/history')
        if [row['frame'] for row in stored['frames'][:count]] == list(range(count)):
            journal_complete.add(stored['session'])
        for row in stored['frames']:
            key = (stored['session'], row['frame'])
            if key in observed_routes and observed_routes[key] != row['routes']:
                raise ValueError('journal route differs from actual worker report')
    if not complete & journal_complete:
        raise ValueError('complete worker sequence lacks its complete route journal')
    return {'verifiedWorkerReports': len(executions), 'coremlPassesInObservedReports': coreml,
            'identities': identities, 'nativeReferenceRoutesInjected': False}


def build(*, evidence, output):
    record = json.loads((evidence / 'e2e-evidence.json').read_text())
    if record.get('status') != 'captured' or record.get('captureEveryFrame') is not True:
        raise ValueError('completed all-frame editor evidence required')
    width, height, count = record['width'], record['height'], record['totalFrames']
    if (width, height) != (1080, 1920) or not 1 <= count <= 1800:
        raise ValueError('bounded 1080p portrait sequence required')
    exported = {}
    for mode in PASSES:
        rows = [item for item in record['exportFrames'] if item['pass'] == mode]
        if [item['frameIndex'] for item in rows] != list(range(count)):
            raise ValueError(f'missing or reordered export frames: {mode}')
        exported[mode] = rows
    previews = {}
    for mode in ('independent',):
        rows = json.loads((evidence / mode / 'preview-export-all-frames.json').read_text())['rows']
        if [item['frame'] for item in rows] != list(range(count)):
            raise ValueError(f'missing or reordered preview frames: {mode}')
        previews[mode] = {row['frame']: row for row in rows}
    samples = record['sampleIndices']
    if not samples or len(samples) != len(set(samples)) or any(index < 0 or index >= count for index in samples):
        raise ValueError('invalid native preview sample indices')
    previews['native'] = {index: {'frame': index, 'file': f'native/preview-frame-{index:06d}-composition.png'} for index in samples}
    output.mkdir(parents=True, exist_ok=True)
    pairs = {name: [] for name in PAIRS}
    preview_mismatches = {mode: [] for mode in previews}
    for index in range(count):
        pixels = {}
        for mode in PASSES:
            row = exported[mode][index]
            pixels[mode] = checked_rgba(path=evidence / row['file'], width=width, height=height,
                                        expected=row['rgbaSha256'])
        for mode, rows in previews.items():
            if index not in rows:
                continue
            preview = checked_rgba(path=evidence / rows[index]['file'], width=width, height=height,
                                   expected=rows[index].get('rgbaSha256'))
            if not np.array_equal(preview, pixels[mode]):
                preview_mismatches[mode].append(index)
        for name, (left, right) in PAIRS.items():
            delta = np.abs(pixels[left][..., :3].astype(np.int16) - pixels[right][..., :3].astype(np.int16))
            pairs[name].append({'frame': index, 'meanAbsoluteRGB': float(delta.mean()),
                                'maximumAbsoluteRGB': int(delta.max()), 'differentPixels': int(np.any(delta != 0, axis=-1).sum())})
    execution = verify_execution(path=evidence / 'independent/execution/execution-evidence.json', count=count)
    summaries = {name: {'mean': float(np.mean([row['meanAbsoluteRGB'] for row in rows])),
                        'p95': float(np.percentile([row['meanAbsoluteRGB'] for row in rows], 95)),
                        'maximum': max(row['maximumAbsoluteRGB'] for row in rows), 'rows': rows}
                 for name, rows in pairs.items()}
    worst = sorted(pairs['native_independent'], key=lambda row: row['meanAbsoluteRGB'], reverse=True)[:4]
    for item in worst:
        images = [np.array(Image.open(evidence / exported[mode][item['frame']]['file']).convert('RGB')) for mode in PASSES]
        delta = np.minimum(np.abs(images[1].astype(np.int16) - images[2].astype(np.int16)) * 8, 255).astype(np.uint8)
        Image.fromarray(delta).save(output / f'difference-{item["frame"]}.png')
    result = {'passed': not any(preview_mismatches.values()), 'scope': 'Real editor default native vs independently selected automatic CoreML; no reference route injection or full native parity claim.',
              'frames': count, 'width': width, 'height': height, 'timelineFPS': record['fps'],
              'uniqueOriginalRgbaFrames': len({row['rgbaSha256'] for row in exported['original']}),
              'sourceProbe': record['sourceProbe'], 'sourceIdentity': record['sourceIdentity'],
              'previewExportMismatches': preview_mismatches, 'pairs': summaries, 'execution': execution,
              'previewComparedFrames': {mode: len(rows) for mode, rows in previews.items()},
              'worstFrames': worst, 'evidence': str(evidence.resolve()), 'evidenceSha256': file_sha(path=evidence / 'e2e-evidence.json')}
    (output / 'metrics.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    contact_frames = list(dict.fromkeys([worst[0]['frame'], max(pairs['original_independent'], key=lambda row: row['meanAbsoluteRGB'])['frame']]))
    contact = Image.new('RGB', (1600, len(contact_frames) * 775), '#181a20')
    draw = ImageDraw.Draw(contact)
    for line, index in enumerate(contact_frames):
        images = [Image.open(evidence / exported[mode][index]['file']).convert('RGB') for mode in PASSES]
        native, owned = (np.array(item).astype(np.int16) for item in images[1:])
        images.append(Image.fromarray(np.minimum(np.abs(native - owned) * 8, 255).astype(np.uint8)))
        mae = pairs['native_independent'][index]['meanAbsoluteRGB']
        draw.text((10, line * 775 + 8), f'Timeline frame {index} | native-owned RGB MAE {mae:.6f} | automatic scheduling, no reference-route injection', fill='white')
        for column, (picture, label) in enumerate(zip(images, ('Original', 'Native default', 'Owned CoreML', 'Absolute native-owned difference x8'))):
            draw.text((column * 400 + 8, line * 775 + 30), label, fill='white')
            contact.paste(picture.resize((400, 711), Image.Resampling.LANCZOS), (column * 400, line * 775 + 54))
    contact.save(output / 'contact-sheet.png')
    rel = lambda path: html.escape(os.path.relpath(path, output), quote=True)
    videos = ''.join(f'<figure><video controls preload="metadata" src="{rel(evidence / mode / "export.mp4")}"></video><figcaption>{label}</figcaption></figure>' for mode, label in zip(PASSES, ('原图', '原生默认', '自研 CoreML')))
    strips = ''.join('<section><h3>Frame ' + str(item['frame']) + '</h3><div class="grid">' + ''.join(f'<figure><img loading="lazy" src="{rel(evidence / exported[mode][item["frame"]]["file"])}"><figcaption>{label}</figcaption></figure>' for mode, label in zip(PASSES, ('原图', '原生', '自研'))) + f'<figure><img loading="lazy" src="difference-{item["frame"]}.png"><figcaption>原生↔自研绝对差 ×8</figcaption></figure></div></section>' for item in worst)
    rows = ''.join(f'<tr><td>{name}</td><td>{summary["mean"]:.6f}</td><td>{summary["p95"]:.6f}</td><td>{summary["maximum"]}</td></tr>' for name, summary in summaries.items())
    (output / 'index.html').write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CoreML 编辑器验收</title><style>body{{margin:28px;background:#181a20;color:#eee;font:16px/1.6 system-ui}}a{{color:#9cd3ff}}.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}.videos{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}figure{{margin:0}}img,video{{width:100%}}td,th{{padding:8px;border:1px solid #777}}table{{border-collapse:collapse}}</style><h1>CoreML 美体：真实编辑器 {count} 帧</h1><p>1080×1920，30 fps 时间线；源视频为 24000/1001 fps。下列统计直接复算全部编码前 PNG，不使用 H.264 差分代替像素证据。</p><p>各自预览↔导出失败帧：{html.escape(str(preview_mismatches))}。独立复核 {execution['verifiedWorkerReports']} 份 worker 报告，确有 CoreML 路由。自动 readiness 自行决定，不输入原生参考路由；跨原生残差完整保留，不声明全部原生功能对齐。</p><div class="videos">{videos}</div><h2>全部 {count} 帧编码前 RGB 差分</h2><table><tr><th>比较</th><th>每帧 MAE 平均</th><th>每帧 MAE p95</th><th>MAX</th></tr>{rows}</table>{strips}<p><a href="metrics.json">完整指标与执行身份</a> · <a href="{rel(evidence / 'e2e-evidence.json')}">E2E 原始记录</a></p></html>''')
    return result


def build_operations(*, evidence, output, ffmpeg):
    module_path = Path(__file__).with_name('body-video-operation-report.py')
    spec = importlib.util.spec_from_file_location('body_operations', module_path)
    operations = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(operations)
    record = json.loads((evidence / 'e2e-evidence.json').read_text())
    if record.get('bodyVideoProfile') != 'swing-coreml-v1':
        raise ValueError('operation report requires explicit CoreML profile')
    videos = operations.verify_decoded_exports(record=record, directory=evidence, ffmpeg=ffmpeg)
    summary = operations.summarize(record=record, verified_videos=videos)
    execution = {}
    for stage in ('initial', 'before-restart', 'after-restart'):
        source = evidence / f'execution-{stage}' / 'execution-evidence.json'
        try:
            execution[stage] = verify_execution(path=source, count=record['frames'])
        except (OSError, ValueError, KeyError) as error:
            execution[stage] = {'error': str(error)}
    preview_checks = []
    for row in record.get('previews', []):
        pixels = checked_rgba(path=evidence / row['file'], width=1080, height=1920, expected=row['rgbaSha256'])
        preview_checks.append({'stage': row['stage'], 'frame': row['frame'],
                               'rgbaSha256': hashlib.sha256(pixels.tobytes()).hexdigest()})
    result = {'passed': summary['status'] == 'passed' and not any('error' in value for value in execution.values()),
              'summary': summary, 'decodedVideos': videos, 'execution': execution,
              'verifiedSavedPreviews': preview_checks, 'evidenceSha256': file_sha(path=evidence / 'e2e-evidence.json'),
              'scope': 'Each operation compared with its own initial CoreML sequence; no cross-native parity claim.'}
    output.mkdir(parents=True, exist_ok=True)
    (output / 'metrics.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    (output / 'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CoreML 操作恢复验收</title><style>body{max-width:1200px;margin:30px auto;background:#181a20;color:#eee;font:16px/1.6 system-ui}a{color:#9cd3ff}td,th{border:1px solid #777;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.fail{color:#ffb4b4}.pass{color:#a4edc0}</style><h1>CoreML 操作与恢复</h1><p>以下是自有初始序列的一致性验收，不是原生像素一致性结论。</p>' + operations.render(summary=summary) + '<p><a href="metrics.json">完整独立复核记录</a></p></html>')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--operations', action='store_true')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    args = parser.parse_args()
    if args.operations:
        result = build_operations(evidence=args.evidence, output=args.output or args.evidence / 'coreml-report', ffmpeg=args.ffmpeg)
        print(json.dumps({'passed': result['passed'], 'status': result['summary']['status']}, indent=2))
        return
    result = build(evidence=args.evidence, output=args.output or args.evidence / 'coreml-report')
    print(json.dumps({'passed': result['passed'], 'frames': result['frames'],
                      'previewExportMismatches': result['previewExportMismatches'],
                      'nativeIndependent': {key: value for key, value in result['pairs']['native_independent'].items() if key != 'rows'}}, indent=2))


if __name__ == '__main__':
    main()
