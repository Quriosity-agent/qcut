"""Validate local-edit evidence and explain its actual application."""


def verify_edit_evidence(*, receipt, edits, changed, unsupported):
    if receipt.get("edits") != edits:
        raise ValueError("receipt edits mismatch")
    evidence = receipt.get("photoEdits", {})
    if not isinstance(evidence, dict):
        raise ValueError("invalid photo edit evidence")
    manual = evidence.get("manual", {})
    if not isinstance(manual, dict):
        raise ValueError("invalid manual edit evidence")
    strokes = manual.get("strokes", [])
    if not isinstance(strokes, list) or any(not isinstance(item, dict) for item in strokes):
        raise ValueError("invalid stroke evidence")
    count = manual.get("appliedCount", 0)
    if type(count) is not int or not 0 <= count <= len(edits["strokes"]):
        raise ValueError("invalid manual edit evidence")
    if count and not changed:
        raise ValueError("manual edits reported on unchanged pixels")
    background = evidence.get("backgroundProtection", {})
    if not isinstance(background, dict):
        raise ValueError("invalid protection evidence")
    if changed and edits["backgroundProtection"] and not unsupported:
        if background.get("applied") is not True or background.get("changedProtectedPixels") != 0:
            raise ValueError("background protection did not verify")
    return count, evidence


def edit_feedback(*, edits, evidence, count):
    background = evidence.get("backgroundProtection", {})
    requested = len(edits["strokes"])
    strokes = evidence.get("manual", {}).get("strokes", [])
    scale_reduced = any(type(item.get("scale")) in (int, float) and 0 < item["scale"] < 1 for item in strokes)
    manual_message = f"手动修形已应用 {count}/{requested} 笔，每次均从原图重算。"
    if scale_reduced:
        manual_message += "部分位移为保持网格稳定已减小。"
    if any(item.get("reason") == "brush lies wholly on protected background" for item in strokes):
        manual_message += "完全落在背景保护范围内的拖动已跳过。"
    protected = background.get("applied") is True
    return {
        "manual": {"requested": requested, "applied": count, "message": manual_message if requested else "未启用手动修形。"},
        "backgroundProtection": {"requested": edits["backgroundProtection"], "applied": protected,
            "message": ("人物轮廓过渡区以外保留原图像素；紧邻轮廓的背景仍可能变形。"
                        if protected else "没有形变，无需背景合成。" if edits["backgroundProtection"]
                        else "背景保护已关闭。")}}
