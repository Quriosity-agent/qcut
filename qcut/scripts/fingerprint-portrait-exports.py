"""Record export hashes at manual capture time; never overwrite historical evidence."""

import argparse
import hashlib
import json
from pathlib import Path


def sha256(*, path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bind_exports(*, manifest, directory):
    def resolve(value):
        path = Path(value)
        return (directory / path).resolve() if not path.is_absolute() else path

    source = resolve(manifest["source"])
    if manifest.get("errors") or manifest["sourceSha256"] != sha256(path=source):
        raise ValueError("Source mismatch or failed capture")
    samples, names = [], set()
    for sample in manifest["samples"]:
        if sample["name"] in names:
            raise ValueError("Duplicate sample")
        names.add(sample["name"])
        path = resolve(sample["exportPath"])
        actual = sha256(path=path)
        if "exportSha256" in sample and sample["exportSha256"] != actual:
            raise ValueError("Export fingerprint mismatch; do not rebind changed evidence")
        samples.append({**sample, "exportPath": str(path), "exportSha256": actual})
    if not samples:
        raise ValueError("Require captured exports")
    return {**manifest, "source": str(source), "samples": samples}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Operator-recorded export labels and paths")
    parser.add_argument("output", type=Path, help="New fingerprinted manifest; must not exist")
    args = parser.parse_args()
    report = bind_exports(manifest=json.loads(args.manifest.read_text(encoding="utf-8")), directory=args.manifest.parent)
    with args.output.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
