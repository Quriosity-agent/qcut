"""Public control identities shared by the HTTP adapter and isolated renderer."""
import json
from pathlib import Path

CONTROL_PARTS = {
    "StretchLeg": "LongLeg",
    "SlimWaist": "SlimWaist",
    "SmallHead": "SmallHead",
    "SlimBody": "SlimBody",
    "SlimArm": "SlimArm",
    "ShoulderWidth": "WidenShoulder",
    "OrthoShoulder": "OrthoShoulder",
    "SwanNeck": "SwanNeck",
    "HipWidth": "SlimHip",
    "BustSize": "SlimBreast",
    "ThighWidth": "ThighWidth",
    "CalfWidth": "CalfWidth",
}
PUBLIC_CONTROLS = tuple(CONTROL_PARTS)
LEG_CONTROLS = ("ThighWidth", "CalfWidth")
ENGINE_ALIASES = {"ShoulderWidth": "WidenShoulderTest", "HipWidth": "SlimHip", "BustSize": "SlimBreast"}
_catalog = json.loads(Path(__file__).with_name("catalog.json").read_text(encoding="utf-8"))
CONTROL_RANGES = {control["name"]: (control["min"], control["max"]) for control in _catalog["controls"]}
if tuple(CONTROL_RANGES) != PUBLIC_CONTROLS:
    raise ValueError("美体目录与公开参数契约不一致。")


def validate_controls(*, controls):
    if not isinstance(controls, dict) or set(controls) - set(PUBLIC_CONTROLS):
        raise ValueError("请求含未知美体项目，请使用当前目录列出的参数。")
    for name, value in controls.items():
        minimum, maximum = CONTROL_RANGES[name]
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError(f"{name} 必须是 {minimum} 到 {maximum} 的整数。")
    return {name: controls.get(name, 0) for name in PUBLIC_CONTROLS}


def to_engine_controls(*, controls):
    return {ENGINE_ALIASES.get(name, name): value
            for name, value in validate_controls(controls=controls).items()
            if name not in LEG_CONTROLS}
