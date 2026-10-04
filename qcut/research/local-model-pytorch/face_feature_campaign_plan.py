"""CPU-only feature planning and immutable source/asset epoch guards."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import subprocess

from PIL import Image

from face_alignment_replay import LockedFiles, strict_json, valid_hash
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest
import face_temporal_campaign as driver

SCRIPT_ROOT = Path(__file__).resolve().parent
REPO = SCRIPT_ROOT.parents[1]
FEATURES = ("eye", "nose", "jaw", "mouth", "skin", "makeup")
CONTROL_CHANGE = [True, True, True, False, True, False, True]
CATALOG_SOURCES = [SCRIPT_ROOT / "face_feature_campaign_catalog.ts", *[
    REPO / "electron/jianying-portrait-adjustment-runtime" / name
    for name in ("catalog.ts", "advanced-controls.ts", "makeup-catalog.ts", "package-resolver.ts",
                 "provider.ts", "tracking-scope-pool.ts")]]


def write_json(*, path, value):
    with path.open("x") as stream:
        stream.write(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def selection(*, values):
    driver.require(condition=isinstance(values, list) and 1 <= len(values) <= len(FEATURES)
                   and len(set(values)) == len(values) and all(value in FEATURES for value in values),
                   message="unique bounded supported feature selection required")
    return values


def catalog(*, runtime, bun, effect_cache_root=None):
    command = [str(bun), str(SCRIPT_ROOT / "face_feature_campaign_catalog.ts"), str(runtime)]
    if effect_cache_root is not None:
        command.append(str(configured_root(path=effect_cache_root)))
    result = subprocess.run(command,
                            capture_output=True, timeout=30, check=True)
    driver.require(condition=len(result.stdout) <= sequence.MANIFEST_LIMIT, message="catalog output too large")
    rows = strict_json(data=result.stdout)
    driver.require(condition=isinstance(rows, list) and [row.get("id") for row in rows] == list(FEATURES),
                   message="complete existing product feature catalog required")
    for row in rows:
        driver.require(condition=set(row["parameters"]) == {"active", "half", "zero"}
                       and row["hostPackage"] in row["packages"], message="feature package/levels missing")
        validate_bindings(spec=row, runtime=runtime, effect_cache_root=effect_cache_root)
    return {row["id"]: row for row in rows}


def configured_root(*, path):
    path = Path(path)
    driver.require(condition=path.is_absolute() and path.is_dir() and path.resolve(strict=True) == path,
                   message="explicit cache root must be a canonical absolute directory without symlinks")
    return sequence.consumer.protocol_path(path=path)


def validate_bindings(*, spec, runtime, effect_cache_root=None, require_available=False):
    bindings = spec.get("packageBindings")
    driver.require(condition=isinstance(bindings, list) and 1 <= len(bindings) <= 2
                   and [row.get("path") for row in bindings] == spec["packages"]
                   and spec["hostPackage"] == spec["packages"][0], message="complete ordered package bindings required")
    roots = {"private": runtime / "Cache/effect"}
    if effect_cache_root is not None:
        roots["effect-cache"] = configured_root(path=effect_cache_root)
    for row in bindings:
        driver.require(condition=isinstance(row.get("resourceId"), str) and re.fullmatch(r"[0-9]{1,32}", row["resourceId"])
                       and isinstance(row.get("version"), str) and re.fullmatch(r"[0-9a-f]{32}", row["version"])
                       and type(row.get("available")) is bool, message="pinned typed resource/version identity required")
        selected = None
        for source, root in roots.items():
            candidate = root / row["resourceId"] / row["version"]
            if not candidate.exists() and not candidate.is_symlink():
                continue
            driver.require(condition=candidate.is_dir() and candidate.resolve(strict=True) == candidate,
                           message=f"pinned package resolves through symlink or is not a directory: {candidate}")
            selected = dict(source=source, root=str(root), path=str(candidate), available=True)
            break
        expected = selected or dict(source="private", root=str(roots["private"]),
            path=str(roots["private"] / row["resourceId"] / row["version"]), available=False)
        driver.require(condition=all(row.get(key) == value for key, value in expected.items()),
                       message="package binding differs from private-first pinned resolution")
        if require_available:
            driver.require(condition=selected is not None,
                           message=f"missing pinned package {row['resourceId']}/{row['version']}; searched: {list(map(str, roots.values()))}")


def root_identities(*, specs):
    roots = {row["root"] for spec in specs for row in spec["packageBindings"]}
    result = {}
    for name in sorted(roots):
        path = configured_root(path=Path(name))
        info = path.stat()
        result[name] = dict(device=info.st_dev, inode=info.st_ino)
    return result


def materialize(*, template, feature, locked):
    frames = sequence.validate_manifest(value=locked.json(path=template), base=template.parent)
    driver.require(condition=len(frames) == 7 and [row["expect_change"] for row in frames] == CONTROL_CHANGE,
                   message="seven-frame face/motion/mirror/no-face/recovery/zero/half fixture required")
    driver.require(condition=all(left["timestamp"] < right["timestamp"] for left, right in zip(frames, frames[1:])),
                   message="strictly increasing timestamps required")
    for index, frame in enumerate(frames):
        image_path = driver.local_path(path=frame["image"])
        data = locked.read(path=image_path, maximum=sequence.IMAGE_LIMIT)
        with Image.open(io.BytesIO(data)) as image:
            sequence.validate_dimensions(width=image.width, height=image.height, expected=driver.DIMENSIONS)
        level = "zero" if index == 5 else "half" if index == 6 else "active"
        frame.update(image=str(image_path), parameters=feature["parameters"][level])
    return dict(version=1, frames=frames)


def epoch(*, paths, packages, locked):
    trees = [driver.TreeGuard(root=SCRIPT_ROOT, source=True),
             driver.TreeGuard(root=SCRIPT_ROOT.parent / "jianying-runtime-probe", source=True),
             driver.TreeGuard(root=paths["runtime"] / "Models")]
    for package in sorted(packages):
        root = Path(package)
        allowed = [paths["runtime"] / "Cache/effect", *([paths["effect_cache_root"]] if "effect_cache_root" in paths else [])]
        driver.require(condition=root.resolve(strict=True) == root and any(root.is_relative_to(parent) for parent in allowed),
                       message="package resolves outside explicitly configured roots")
        trees.append(driver.TreeGuard(root=root))
    libraries = {}
    for name, expected in driver.RUNTIME_HASHES.items():
        path = paths["runtime"] / "Frameworks" / name
        libraries[str(path)] = driver.file_fingerprint(path=path)
        driver.require(condition=libraries[str(path)]["sha256"] == expected, message=f"unverified native library: {name}")
    locked.read(path=paths["runtime"] / "Models" / driver.MODEL.name,
                maximum=driver.FILE_LIMIT, expected=driver.MODEL_SHA256)
    summary = locked.json(path=paths["models_root"] / "summary.json")
    parity.validate_export(exported=summary)
    for side in (120, 160):
        name = f"align-{side}/artifacts/model.onnx"
        locked.read(path=paths["models_root"] / name, maximum=128 * 1024**2, expected=summary["artifacts"][name])
    return trees, libraries


def build(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    features = selection(values=args.feature or list(FEATURES))
    driver.require(condition=1 <= len(args.manifest) <= 3, message="1-3 explicit portrait manifests required")
    templates = [driver.local_path(path=path) for path in args.manifest]
    driver.require(condition=len({path.resolve() for path in templates}) == len(templates), message="duplicate portrait manifest")
    paths = {key: driver.local_path(path=getattr(args, key), directory=key in ("runtime", "models_root"))
             for key in ("runtime", "models_root", "warp_python", "ort_python", "bun")}
    if getattr(args, "effect_cache_root", None) is not None:
        paths["effect_cache_root"] = configured_root(path=args.effect_cache_root)
    for key in ("warp_python", "ort_python", "bun"):
        driver.require(condition=os.access(paths[key], os.X_OK), message="executable tool required")
        locked.read(path=paths[key], maximum=driver.FILE_LIMIT)
        config = paths[key].parent.parent / "pyvenv.cfg"
        if key != "bun" and config.exists():
            locked.read(path=config, maximum=65536)
    for source in CATALOG_SOURCES:
        locked.read(path=source, maximum=sequence.LOG_LIMIT)
    choices = catalog(runtime=paths["runtime"], bun=paths["bun"], effect_cache_root=paths.get("effect_cache_root"))
    specs = [choices[name] for name in features]
    for spec in specs:
        validate_bindings(spec=spec, runtime=paths["runtime"], effect_cache_root=paths.get("effect_cache_root"), require_available=True)
    package_roots = root_identities(specs=specs)
    packages = {path for name in features for path in choices[name]["packages"]}
    trees, libraries = epoch(paths=paths, packages=packages, locked=locked)
    cases = []
    for index, template in enumerate(templates):
        for name in features:
            identity = f"portrait-{index:02d}-{name}"
            manifest = out / f"{identity}.json"
            write_json(path=manifest, value=materialize(template=template, feature=choices[name], locked=locked))
            locked.read(path=manifest, maximum=sequence.MANIFEST_LIMIT)
            cases.append(dict(id=identity, feature=name, template=str(template), manifest=str(manifest),
                              input_kind="synthetic-seven-frame-controls", **{"spec": choices[name]}))
    driver.verify_guards(locked=locked, guards=trees, libraries=libraries)
    fingerprints = {name: driver.file_fingerprint(path=Path(name)) for name in locked.files}
    plan = dict(format="face-feature-campaign-plan-v2", native_execution_performed=False,
                candidate_parity=False, product_parity_verified=False, paths={key: str(value) for key, value in paths.items()},
                cases=cases, locked_files=fingerprints, package_roots=package_roots,
                trees=[dict(root=str(tree.root), source=tree.source, files=tree.files) for tree in trees],
                libraries=libraries, dependencies=["native-detector", "native-algorithm-rgba", "native-caller-geometry",
                    "native-routing", "native-effect-renderer"],
                scope="bounded still-derived controls, not live video or full backend independence")
    verify_epoch(plan=plan)
    write_json(path=out / "plan.json", value=plan)
    return dict(plan=str(out / "plan.json"), sha256=digest(data=(out / "plan.json").read_bytes()),
                cases=len(cases), features=features, source_files=sum(len(tree.files) for tree in trees if tree.source))


def verify_epoch(*, plan):
    if plan.get("format") == "face-feature-campaign-plan-v2":
        specs = [case["spec"] for case in plan["cases"]]
        paths = {key: Path(value) for key, value in plan["paths"].items()}
        for spec in specs:
            validate_bindings(spec=spec, runtime=paths["runtime"], effect_cache_root=paths.get("effect_cache_root"), require_available=True)
        driver.require(condition=root_identities(specs=specs) == plan["package_roots"], message="resolved package root identity changed")
    for name, expected in plan["locked_files"].items():
        driver.require(condition=driver.file_fingerprint(path=Path(name)) == expected, message=f"locked asset/source changed: {name}")
    for tree in plan["trees"]:
        current = driver.TreeGuard(root=Path(tree["root"]), source=tree["source"])
        driver.require(condition=current.files == tree["files"], message=f"source/runtime/package epoch changed: {tree['root']}")
    for name, expected in plan["libraries"].items():
        driver.require(condition=driver.file_fingerprint(path=Path(name)) == expected, message=f"native library changed: {name}")


def load(*, path, expected_sha256):
    driver.require(condition=valid_hash(value=expected_sha256), message="explicit SHA256 plan identity required")
    locked = LockedFiles()
    plan = strict_json(data=locked.read(path=path, maximum=16 * 1024**2, expected=expected_sha256))
    driver.require(condition=plan.get("format") == "face-feature-campaign-plan-v2"
                   and plan.get("native_execution_performed") is False and plan.get("candidate_parity") is False,
                   message="CPU-only campaign plan required")
    cases = plan.get("cases")
    driver.require(condition=isinstance(cases, list) and 1 <= len(cases) <= 18
                   and len({row["id"] for row in cases}) == len(cases), message="bounded unique cases required")
    for row in cases:
        portrait = int(row["id"].split("-")[1])
        driver.require(condition=0 <= portrait <= 2 and row["id"] == f"portrait-{portrait:02d}-{row['feature']}"
                       and row["feature"] in FEATURES and row["spec"]["id"] == row["feature"]
                       and row["input_kind"] == "synthetic-seven-frame-controls", message="unsupported case identity/profile")
        for name in (row["manifest"], row["template"]):
            driver.require(condition=name in plan["locked_files"], message="unbound manifest/template")
    paths = {key: Path(value) for key, value in plan["paths"].items()}
    packages = {name for row in cases for name in row["spec"]["packages"]}
    expected_roots = {str(SCRIPT_ROOT): True, str(SCRIPT_ROOT.parent / "jianying-runtime-probe"): True,
                      str(paths["runtime"] / "Models"): False, **{name: False for name in packages}}
    driver.require(condition={tree["root"]: tree["source"] for tree in plan["trees"]} == expected_roots
                   and len(plan["trees"]) == len(expected_roots)
                   and all(tree["files"] for tree in plan["trees"]), message="complete source/runtime/package trees required")
    for key in ("warp_python", "ort_python", "bun"):
        driver.require(condition=str(paths[key]) in plan["locked_files"], message="unbound executable")
    for source in CATALOG_SOURCES:
        driver.require(condition=str(source) in plan["locked_files"], message="unbound product catalog")
    driver.require(condition=set(plan["libraries"]) == {str(paths["runtime"] / "Frameworks" / name)
                   for name in driver.RUNTIME_HASHES}, message="complete native library guards required")
    verify_epoch(plan=plan)
    return plan
