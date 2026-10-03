"""Version-pinned static injection inventory; never executes a vendor function."""
import argparse
import json
from pathlib import Path
import platform
import re
import subprocess
import sys

import espresso_oracle


LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks/libcccreator.dylib"
LIBRARY_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"
UUID = "D6342ECD-5432-33F0-A2AD-0C28F5699994"
SYMBOLS = (
    "_bef_effect_algorithm_cap_set_algorithm_buffer",
    "_bef_effect_algorithm_cap_set_all_algorithm_buffers",
    "_bef_effect_algorithm_cap_set_algorithm_result_serialize",
    "_bef_effect_algorithm_cap_set_all_algorithm_results_serialize",
    "_bef_effect_set_external_algorithm",
    "_bef_effect_set_external_new_algorithm",
    "_bef_effect_set_external_algorithm_array",
    "__ZN22TEStickerEffectWrapper23setExternalAlgorithmEffE17BefRequirement_ST",
    "__ZN22TEStickerEffectWrapper26setExternalAlgorithmEffNewE20BefRequirementNew_ST",
)


def branch_target(*, text):
    instructions = re.findall(r"^\s*[0-9a-f]+:\s+(?:[0-9a-f]{2}\s+){4}(.*?)\s*$", text, re.MULTILINE)
    if len(instructions) != 1:
        return None
    match = re.fullmatch(r"b\s+0x([0-9a-f]+)", instructions[0])
    return int(match.group(1), 16) if match else None


def constant_return(*, text):
    instructions = [line.split(";", 1)[0].strip() for line in re.findall(r"<\+\d+>:\s*(.*)", text)]
    if len(instructions) != 2 or instructions[1] != "ret":
        return None
    match = re.fullmatch(r"mov\s+w0,\s*#(-?(?:0x[0-9a-f]+|[0-9]+))", instructions[0])
    return int(match.group(1), 0) if match else None


def command(*, args, maximum=200000):
    result = subprocess.run(args, capture_output=True, text=True, check=True, timeout=60)
    if len(result.stdout) > maximum:
        raise ValueError("refusing unbounded static disassembly output")
    return result.stdout


def run(*, library, output):
    output = espresso_oracle.private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite injection inventory")
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise ValueError("inventory is pinned to macOS arm64")
    library = Path(library).resolve()
    if espresso_oracle.sha256(path=library) != LIBRARY_SHA256:
        raise ValueError("effect core hash mismatch")
    uuid = command(args=["xcrun", "dwarfdump", "--uuid", str(library)])
    if not re.search(r"UUID: " + re.escape(UUID) + r" \(arm64\)", uuid):
        raise ValueError("effect core architecture UUID mismatch")
    exports = command(args=["nm", "-arch", "arm64", "-gU", str(library)], maximum=32000000)
    names = {line.split()[-1] for line in exports.splitlines() if len(line.split()) == 3}
    if not set(SYMBOLS) <= names:
        raise ValueError("missing injection inventory symbols")
    output.mkdir(parents=True)
    (output / "uuid.txt").write_text(uuid)
    reports, targets = {}, {}
    for index, symbol in enumerate(SYMBOLS):
        text = command(args=["xcrun", "llvm-objdump", "--macho", "--arch=arm64", "--disassemble",
                             "--dis-symname", symbol, str(library)])
        if symbol + ":" not in text or not re.search(r"^\s*[0-9a-f]+:\s", text, re.MULTILINE):
            raise ValueError("targeted symbol disassembly missing")
        path = output / f"symbol-{index}.txt"
        path.write_text(text)
        target = branch_target(text=text)
        code = None
        if target is not None:
            if target not in targets:
                target_text = command(args=["lldb", "--batch", "--no-lldbinit", "-o",
                                            "target create " + json.dumps(str(library)) + " --arch arm64",
                                            "-o", f"disassemble --start-address {target:#x} --count 2", "-o", "quit"])
                targets[target] = constant_return(text=target_text)
                (output / f"target-{target:x}.txt").write_text(target_text)
            code = targets[target]
        reports[symbol] = {"branch_target": None if target is None else f"{target:#x}", "constant_return": code,
                           "status": "constant_error_stub" if code is not None and code < 0 else "ABI_and_consumption_unverified",
                           "disassembly_sha256": espresso_oracle.sha256(path=path)}
    report = {"inventory_completed": True, "external_injection_verified": False, "native_function_called": False,
              "effect_core_sha256": LIBRARY_SHA256, "arm64_uuid": UUID, "symbols": reports,
              "evidence": {path.name: espresso_oracle.sha256(path=path) for path in output.glob("*.txt")},
              "unverified": ["BefRequirement_ST/BefRequirementNew_ST ABI", "face result ownership and lifetime",
                             "consumer vtable target", "internal analysis bypass", "render response to external points"]}
    (output / "summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=LIBRARY)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = run(library=args.library, output=args.out)
    print(json.dumps({"inventory_completed": report["inventory_completed"], "external_injection_verified": False,
                      "constant_error_stubs": sum(item["status"] == "constant_error_stub" for item in report["symbols"].values())}))


if __name__ == "__main__":
    main()
