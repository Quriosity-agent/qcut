#!/usr/bin/env python3
"""Exercise the independent Fog command line with original temporary inputs."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    executable = parser.parse_args().executable.resolve()
    calls = 0
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source, output = root / "input.rgba", root / "output.rgba"
        source.write_bytes(bytes([11, 128, 243, 255]) * 35)
        base = ["--input", str(source), "--width", "7", "--height", "5", "--output", str(output)]

        def run(arguments, success=True):
            nonlocal calls
            calls += 1
            result = subprocess.run([str(executable), *arguments], capture_output=True, text=True)
            if (result.returncode == 0) != success:
                raise AssertionError((arguments, result.returncode, result.stdout, result.stderr))
            return result

        run(["--help"])
        result = run([*base, "--intensity", "0", "--trace", str(root / "trace")])
        assert json.loads(result.stdout)["intensity"] == 0
        assert output.read_bytes() == source.read_bytes()
        assert sorted(p.name for p in (root / "trace").iterdir()) == [
            "00-input.rgba", "01-blur-x.rgba", "02-blur-y.rgba", "03-fog.rgba", "04-lut.rgba"]
        assert all(p.stat().st_size == 140 for p in (root / "trace").iterdir())
        run(base)
        full = output.read_bytes()
        run([*base, "--intensity", "1"])
        assert output.read_bytes() == full
        for strength in ["-0.1", "1.1", "nan", "inf", "0.3junk"]:
            run([*base, "--intensity", strength], False)
            assert output.read_bytes() == full
        for extra in [["--demo"], ["--width", "0"], ["--height", "-1"], ["--width", "16385"],
                      ["--width", "7.0"], ["--unknown", "1"], ["--intensity"]]:
            run([*base, *extra], False)
        run(["--demo", "--width", "7", "--height", "5", "--output", str(root / "demo.ppm")])
        assert (root / "demo.ppm").read_bytes().startswith(b"P6\n7 5\n255\n")
        source.write_bytes(source.read_bytes()[:-1])
        run(base, False)
        source.write_bytes(bytes([11, 128, 243, 128]) * 35)
        run(base, False)
        source.write_bytes(bytes([11, 128, 243, 255]) * 35)
        invalid_lut = root / "short-lut.rgba"
        invalid_lut.write_bytes(bytes(4))
        run([*base, "--lut", str(invalid_lut)], False)
        assert output.read_bytes() == full
    print(f"{calls} Fog CLI checks passed")


if __name__ == "__main__":
    main()
