"""Opt-in CPU photo controls; the original Metal contract stays unchanged."""
if __package__:
    from .control_contract import CONTROL_PARTS, validate_controls
else:
    from control_contract import CONTROL_PARTS, validate_controls


REGION_CONTROLS = ("Abdomen", "ButtLift", "ButtShape", "LegStraighten", "AnkleWidth")
SKIN_CONTROLS = ("BodySkinTone", "BodySkinWarmth", "BodySkinSmooth", "BodyBlemish")
EXTRA_CATALOG = (
    {"name": "Abdomen", "title": "独立收腹", "min": 0, "max": 100, "group": "abdomen",
     "note": "局部收拢腹部轮廓，区别于整体瘦腰。"},
    {"name": "ButtLift", "title": "提臀", "min": 0, "max": 100, "group": "buttocks",
     "note": "上移局部臀部轮廓，属于二维照片修形。"},
    {"name": "ButtShape", "title": "臀型宽度", "min": -50, "max": 50, "group": "buttocks",
     "note": "改变胯线以下的臀部宽度，不生成侧面立体体积。"},
    {"name": "LegStraighten", "title": "腿型拉直", "min": 0, "max": 100, "group": "legs",
     "note": "仅修饰近正立、双腿关节可信的照片；屈膝或交叉可能不可用。"},
    {"name": "AnkleWidth", "title": "脚踝粗细", "min": -50, "max": 50, "group": "legs",
     "note": "负值收细，正值加宽；保留鞋部所在区域。"},
    {"name": "BodySkinTone", "title": "身体明暗", "min": -50, "max": 50, "group": "skin",
     "note": "负值加深，正值提亮；保守识别露出的身体皮肤，保留头脸。"},
    {"name": "BodySkinWarmth", "title": "身体冷暖", "min": -50, "max": 50, "group": "skin",
     "note": "负值偏冷，正值偏暖；不把整件衣服作为皮肤调色。"},
    {"name": "BodySkinSmooth", "title": "身体磨皮", "min": 0, "max": 100, "group": "skin",
     "note": "柔化已识别的皮肤纹理，识别不可靠时跳过。"},
    {"name": "BodyBlemish", "title": "淡化小瑕疵", "min": 0, "max": 100, "group": "skin",
     "note": "淡化局部小斑点，不生成新皮肤，也不保证去除大面积纹身或疤痕。"},
)
EXTRA_RANGES = {item["name"]: (item["min"], item["max"]) for item in EXTRA_CATALOG}


def validate_photo_controls(*, controls, extended=False):
    if not extended or not isinstance(controls, dict) or not set(controls) & EXTRA_RANGES.keys():
        return validate_controls(controls=controls)
    if set(controls) - (CONTROL_PARTS.keys() | EXTRA_RANGES.keys()):
        raise ValueError("请求含未知美体项目，请使用当前目录列出的参数。")
    legacy = validate_controls(controls={name: value for name, value in controls.items()
                                       if name in CONTROL_PARTS})
    extra = {}
    for name, (minimum, maximum) in EXTRA_RANGES.items():
        value = controls.get(name, 0)
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError(f"{name} 必须是 {minimum} 到 {maximum} 的整数。")
        extra[name] = value
    return {**legacy, **extra}


def control_parts(*, values):
    return {**CONTROL_PARTS, **{name: name for name in EXTRA_RANGES if name in values}}


def legacy_controls(*, values):
    return {name: values[name] for name in CONTROL_PARTS}


def extended_catalog(*, catalog):
    groups = [{"id": name, "title": title} for name, title in (
        ("proportion", "整体比例"), ("upper", "肩颈与上身"), ("abdomen", "腰腹"),
        ("buttocks", "胯部与臀型"), ("legs", "腿部与脚踝"), ("skin", "身体肤色与皮肤"))]
    legacy_groups = {"SlimWaist": "abdomen", "HipWidth": "buttocks", "StretchLeg": "legs",
                     "ThighWidth": "legs", "CalfWidth": "legs", "SlimArm": "upper",
                     "ShoulderWidth": "upper", "OrthoShoulder": "upper", "SwanNeck": "upper",
                     "BustSize": "upper"}
    controls = [{**item, "group": legacy_groups.get(item["name"], "proportion")}
                for item in catalog["controls"]]
    controls.extend({**item, "default": 0, "step": 1} for item in EXTRA_CATALOG)
    return {**catalog, "controls": controls, "groups": groups, "backend": "portable-CPU",
            "scope": "单人静态照片；各部位按可见关节和皮肤识别分别判定"}
