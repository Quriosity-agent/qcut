"""Finalize diagnostic evidence without replacing its primary execution error."""
import json
import sys


def finish(*, out, report, locked):
    active_error = sys.exc_info()[1]
    try:
        locked.verify()
    except Exception as error:
        report.update(passed=False, completed=False)
        report["failures"].append(f"guard {type(error).__name__}: {error}")
        if active_error is None:
            raise
    finally:
        if report["passed"] is not True:
            for key in ("sampling_parity", "observer_pixel_parity_verified"):
                if key in report:
                    report[key] = False
            if "sampling_parity" in report:
                report.update(exact_modes=[], native_algorithm_rgba_required=True)
        report["fixture_sha256"] = dict(locked.files)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
