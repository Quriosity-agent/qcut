"""Photo ownership, request contracts and actual engine-output verification."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from PIL import Image

from body.backend import AppError, BodyBackend, EngineRunner, image_identity, sha256, write_json
from body.control_contract import PUBLIC_CONTROLS


def picture(*, size=(32, 48), mode="RGB", color=(130, 80, 50)):
    stream = io.BytesIO()
    Image.new(mode, size, color).save(stream, format="PNG")
    return stream.getvalue()


class FakeEngine:
    def __init__(self, *, fault=None, missing=()):
        self.fault, self.missing, self.calls = fault, missing, []

    def __call__(self, *, source, values, output, report):
        self.calls.append({"source": source.read_bytes(), "values": dict(values)})
        with Image.open(source) as original:
            image = original.convert("RGBA")
            before = image_identity(image=image)
        if self.fault != "no-person":
            image.putpixel((0, 0), (255, 0, 0, 255))
        if self.fault == "dimensions":
            image = image.resize((3, 4))
        if self.fault == "alpha":
            image.putpixel((0, 0), (255, 0, 0, 0))
        image.save(output, format="PNG")
        receipt = {"inputRgbaSha256": before["rgbaSha256"],
                   "outputRgbaSha256": image_identity(image=image)["rgbaSha256"],
                   "inputPngSha256": sha256(data=source.read_bytes()),
                   "outputPngSha256": sha256(data=output.read_bytes()), "controls": values,
                   "independence": {"private_native_images": []},
                   "metal": {"privateNativeImages": []},
                   "parts": {name: {"moved": name not in self.missing and self.fault != "no-person",
                                    "intensity": None if name == "SlimArm" else values[name] / 100}
                             for name in PUBLIC_CONTROLS}}
        if self.fault == "hash":
            receipt["outputRgbaSha256"] = "0" * 64
        if self.fault == "input":
            receipt["inputRgbaSha256"] = "0" * 64
        if self.fault == "missing-inventory":
            receipt.pop("independence")
            receipt.pop("metal")
        if self.fault == "native":
            receipt["metal"]["privateNativeImages"] = ["/private/libcccreator.dylib"]
        if self.fault == "hidden-native":
            receipt["independence"]["loaded_images"] = ["/private/liblens.dylib"]
        if self.fault == "missing-parts":
            receipt.pop("parts")
        if self.fault == "false-parts":
            receipt["parts"] = {name: {"moved": False} for name in receipt["parts"]}
        if self.fault == "unrequested-part":
            receipt["parts"] = {"SlimWaist": {"moved": True}}
        if self.fault == "receipt-list":
            receipt = []
        write_json(path=report, value=receipt)


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        write_json(path=self.root / "catalog.json", value={"controls": []})
        self.engine = FakeEngine()
        self.backend = BodyBackend(root=self.root, runner=self.engine, platform="darwin")

    def tearDown(self):
        self.temporary.cleanup()

    def imported(self):
        return self.backend.import_photo(data=picture())

    def render(self, *, values=None):
        photo = self.imported()
        return self.backend.render(request={"photoId": photo["photoId"], "values": {"StretchLeg": 70} if values is None else values})

    def test_upload_saves_owned_png_with_exact_identity(self):
        photo = self.imported()
        path, stored = self.backend.photo(identifier=photo["photoId"])
        self.assertEqual(photo, stored)
        self.assertEqual(photo["pngSha256"], sha256(data=path.read_bytes()))
        self.assertEqual((photo["width"], photo["height"]), (32, 48))

    def test_alpha_is_explicitly_flattened_to_white(self):
        photo = self.backend.import_photo(data=picture(mode="RGBA", color=(0, 0, 0, 0)))
        path, _ = self.backend.photo(identifier=photo["photoId"])
        with Image.open(path) as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        self.assertIn("白色", photo["message"])

    def test_only_documented_photo_formats_are_decoded(self):
        for format_name in ("PNG", "JPEG", "WEBP"):
            with self.subTest(format=format_name):
                stream = io.BytesIO()
                Image.new("RGB", (32, 48), (130, 80, 50)).save(stream, format=format_name)
                photo = self.backend.import_photo(data=stream.getvalue())
                self.assertEqual((photo["width"], photo["height"]), (32, 48))
        for format_name in ("BMP", "TIFF", "GIF"):
            with self.subTest(format=format_name):
                stream = io.BytesIO()
                Image.new("RGB", (32, 48)).save(stream, format=format_name)
                with self.assertRaises(AppError) as raised:
                    self.backend.import_photo(data=stream.getvalue())
                self.assertEqual(raised.exception.code, "invalid_image")

    def test_exif_orientation_applied_before_size_recorded(self):
        stream = io.BytesIO()
        image = Image.new("RGB", (80, 40), (200, 100, 50))
        exif = Image.Exif()
        exif[274] = 6
        image.save(stream, format="JPEG", exif=exif)
        photo = self.backend.import_photo(data=stream.getvalue())
        self.assertEqual((photo["width"], photo["height"]), (40, 80))

    def test_large_source_normalizes_with_aspect_and_pixel_budget(self):
        photo = self.backend.import_photo(data=picture(size=(4200, 2100)))
        self.assertLessEqual(photo["width"], 4096)
        self.assertLessEqual(photo["width"] * photo["height"], 8_294_400)
        self.assertAlmostEqual(photo["width"] / photo["height"], 2, places=3)

    def test_extremely_narrow_source_rejected_before_engine(self):
        with self.assertRaisesRegex(AppError, "狭长"):
            self.backend.import_photo(data=picture(size=(32, 8192)))

    def test_invalid_and_animated_uploads_rejected(self):
        with self.assertRaises(AppError):
            self.backend.import_photo(data=b"not an image")
        stream = io.BytesIO()
        Image.new("RGB", (5, 6), "red").save(stream, format="GIF", save_all=True,
            append_images=[Image.new("RGB", (5, 6), "blue")], duration=100)
        with self.assertRaisesRegex(AppError, "静态"):
            self.backend.import_photo(data=stream.getvalue())

    def test_zero_is_byte_identity_without_engine(self):
        result = self.render(values={})
        self.assertEqual(result["status"], "identity")
        self.assertEqual(self.engine.calls, [])
        source, _ = self.backend.photo(identifier=result["photoId"])
        output = self.backend.stored_file(category="renders", identifier=result["renderId"])
        self.assertEqual(source.read_bytes(), output.read_bytes())

    def test_each_render_restarts_from_original(self):
        photo = self.imported()
        first = self.backend.render(request={"photoId": photo["photoId"], "values": {"StretchLeg": 100}})
        second = self.backend.render(request={"photoId": photo["photoId"], "values": {"SlimWaist": 60}})
        self.assertEqual(len(self.engine.calls), 2)
        self.assertEqual(self.engine.calls[0]["source"], self.engine.calls[1]["source"])
        self.assertEqual(first["source"], second["source"])
        self.assertEqual(second["values"], {name: 60 if name == "SlimWaist" else 0 for name in PUBLIC_CONTROLS})

    def test_body_and_arm_apply_independently_with_unused_controls_zeroed(self):
        for name in ("SlimBody", "SlimArm"):
            with self.subTest(control=name):
                result = self.render(values={name: 100})
                self.assertEqual(result["status"], "applied")
                self.assertTrue(result["controls"][name]["applied"])
                self.assertEqual(self.engine.calls[-1]["values"],
                                 {control: 100 if control == name else 0 for control in
                                  PUBLIC_CONTROLS})
                self.assertEqual(sum(item["applied"] for item in result["controls"].values()), 1)
                receipt = json.loads(self.backend.stored_file(category="receipts",
                    identifier=result["renderId"]).read_text(encoding="utf-8"))
                self.assertTrue(receipt["parts"][name]["moved"])
                if name == "SlimArm":
                    self.assertIsNone(receipt["parts"][name]["intensity"])

    def test_all_five_controls_require_each_requested_part_to_apply(self):
        values = {"StretchLeg": 40, "SlimWaist": 50, "SmallHead": 20, "SlimBody": 60, "SlimArm": 70}
        self.assertEqual(self.render(values=values)["status"], "applied")
        for missing in ("SlimBody", "SlimArm"):
            self.backend.runner = FakeEngine(missing=(missing,))
            with self.subTest(missing=missing):
                result = self.render(values=values)
                self.assertEqual(result["status"], "partial")
                self.assertEqual(sum(item["applied"] for item in result["controls"].values()), 4)
                self.assertFalse(result["controls"][missing]["applied"])
        self.backend.runner = FakeEngine(missing=("SlimBody", "SlimArm"))
        with self.assertRaises(AppError) as error:
            self.render(values={"SlimBody": 100, "SlimArm": 100})
        self.assertEqual(error.exception.code, "invalid_render")

    def test_applied_partial_and_no_person_statuses(self):
        self.assertEqual(self.render()["status"], "applied")
        self.backend.runner = FakeEngine(missing=("SmallHead",))
        partial = self.render(values={"StretchLeg": 80, "SmallHead": 30})
        self.assertEqual(partial["status"], "partial")
        self.assertTrue(partial["controls"]["StretchLeg"]["applied"])
        self.assertFalse(partial["controls"]["SmallHead"]["applied"])
        self.backend.runner = FakeEngine(fault="no-person")
        self.assertEqual(self.render()["status"], "unavailable")

    def test_platform_support_is_honest_and_zero_still_works(self):
        self.backend.platform_name = "freebsd"
        self.assertFalse(self.backend.catalog()["platform"]["supported"])
        self.assertEqual(self.render()["status"], "unavailable")
        self.assertEqual(self.render(values={})["status"], "identity")
        self.assertEqual(self.engine.calls, [])

    def test_missing_body_explains_why_small_head_is_also_unavailable(self):
        engine = FakeEngine(fault="no-person")

        def missing_body(*, source, values, output, report):
            engine(source=source, values=values, output=output, report=report)
            receipt = json.loads(report.read_text())
            receipt["reason"] = "no person detected"
            write_json(path=report, value=receipt)

        self.backend.runner = missing_body
        response = self.render(values={"SmallHead": 100})
        self.assertEqual(response["status"], "unavailable")
        self.assertIn("人体关键点", response["message"])
        self.assertIn("美体项目均依赖人体识别", response["controls"]["SmallHead"]["message"])
        self.assertFalse(response["controls"]["SmallHead"]["applied"])

    def test_strict_control_validation(self):
        photo = self.imported()
        for values in ({"Unknown": 10}, {"SlimWaist": True}, {"SmallHead": 1.5}, {"StretchLeg": 101}, {"SmallHead": -1}, []):
            with self.subTest(values=values), self.assertRaises(AppError):
                self.backend.render(request={"photoId": photo["photoId"], "values": values})
        for request in ({}, {"photoId": photo["photoId"], "values": {}, "engine": "native"}):
            with self.assertRaises(AppError):
                self.backend.render(request=request)

    def test_new_controls_reject_invalid_ranges_and_types_before_running_engine(self):
        for name in ("SlimBody", "SlimArm"):
            for value in (-1, 101, True, 1.5, "30", None, float("nan"), float("inf")):
                with self.subTest(control=name, value=value), self.assertRaises(AppError) as error:
                    self.render(values={name: value})
                self.assertEqual(error.exception.code, "invalid_request")
                self.assertEqual(error.exception.status, 400)
        self.assertEqual(self.engine.calls, [])

    def test_stale_and_path_ids_rejected(self):
        for identifier in ("0" * 32, "../catalog", "/tmp/photo", None):
            with self.subTest(identifier=identifier), self.assertRaises(AppError) as error:
                self.backend.photo(identifier=identifier)
            self.assertEqual(error.exception.status, 404)

    def test_mutated_source_rejected(self):
        photo = self.imported()
        source = self.backend.state / "photos" / f"{photo['photoId']}.png"
        source.write_bytes(picture(color=(20, 30, 40)))
        with self.assertRaises(AppError):
            self.backend.photo(identifier=photo["photoId"])

    @unittest.skipUnless(os.name == "posix", "symlink creation requires privileged Windows setup")
    def test_symlink_source_rejected(self):
        photo = self.imported()
        source = self.backend.state / "photos" / f"{photo['photoId']}.png"
        source.unlink()
        source.symlink_to(self.root / "catalog.json")
        with self.assertRaises(AppError):
            self.backend.photo(identifier=photo["photoId"])

    def test_busy_returns_without_queuing_engine(self):
        self.backend.render_lock.acquire()
        try:
            with self.assertRaises(AppError) as error:
                self.render()
            self.assertEqual(error.exception.code, "render_busy")
            self.assertEqual(self.engine.calls, [])
        finally:
            self.backend.render_lock.release()

    def test_invalid_engine_outputs_are_never_delivered(self):
        for fault in ("dimensions", "alpha", "hash", "input", "missing-inventory", "native", "hidden-native", "receipt-list"):
            self.backend.runner = FakeEngine(fault=fault)
            with self.subTest(fault=fault), self.assertRaises(AppError) as error:
                self.render()
            self.assertEqual(error.exception.code, "invalid_render")
            self.assertEqual(list((self.backend.state / "renders").iterdir()), [])
            self.assertFalse(self.backend.render_lock.locked())

    def test_failed_runner_cleans_artifacts_and_keeps_original(self):
        photo = self.imported()
        source, _ = self.backend.photo(identifier=photo["photoId"])
        original = source.read_bytes()
        failures = (AppError(message="engine failed", code="engine_failed", status=503),
                    RuntimeError("engine interrupted"), KeyboardInterrupt())
        for failure in failures:
            def fail(*, source, values, output, report):
                output.write_bytes(b"partial PNG")
                report.write_text('{"partial":true}', encoding="utf-8")
                raise failure
            self.backend.runner = fail
            with self.subTest(failure=type(failure).__name__), self.assertRaises(type(failure)) as error:
                self.backend.render(request={"photoId": photo["photoId"], "values": {"StretchLeg": 70}})
            self.assertIs(error.exception, failure)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(list((self.backend.state / "renders").iterdir()), [])
            self.assertEqual(list((self.backend.state / "receipts").iterdir()), [])
            self.assertFalse(self.backend.render_lock.locked())

    def test_changed_output_requires_a_requested_moved_part(self):
        for fault in ("missing-parts", "false-parts", "unrequested-part"):
            self.backend.runner = FakeEngine(fault=fault)
            with self.subTest(fault=fault), self.assertRaises(AppError) as error:
                self.render(values={"StretchLeg": 70})
            self.assertEqual(error.exception.status, 502)
            self.assertEqual(error.exception.code, "invalid_render")
            self.assertEqual(list((self.backend.state / "renders").iterdir()), [])
            self.assertEqual(list((self.backend.state / "receipts").iterdir()), [])
            self.assertFalse(self.backend.render_lock.locked())

    def test_download_and_receipt_paths_exist_after_success(self):
        result = self.render()
        self.assertEqual(result["result"]["width"], 32)
        for category in ("renders", "download", "receipts"):
            self.assertTrue(self.backend.stored_file(category=category, identifier=result["renderId"]).is_file())

    def test_close_is_permanent_and_idempotent_without_starting_new_work(self):
        photo = self.imported()
        self.backend.close()
        self.backend.close()
        with self.assertRaises(AppError) as error:
            self.backend.render(request={"photoId": photo["photoId"], "values": {"StretchLeg": 50}})
        self.assertEqual((error.exception.code, error.exception.status), ("service_closing", 503))
        self.assertEqual(self.engine.calls, [])
        runner = EngineRunner(root=self.root)
        runner.close()
        with patch("body.backend.subprocess.Popen") as spawn, self.assertRaises(AppError) as error:
            runner(source=self.root / "source.png", values={}, output=self.root / "unused.png",
                   report=self.root / "unused.json")
        self.assertEqual(error.exception.code, "service_closing")
        spawn.assert_not_called()

    def test_close_wins_a_render_waiting_for_source_validation(self):
        photo = self.imported()
        entered, resume = threading.Event(), threading.Event()
        original = self.backend.photo
        errors = []

        def delayed_photo(**arguments):
            value = original(**arguments)
            entered.set()
            if not resume.wait(timeout=5):
                raise RuntimeError("source-validation test did not resume")
            return value

        def render():
            try:
                self.backend.render(request={"photoId": photo["photoId"], "values": {"StretchLeg": 50}})
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=render)
        try:
            with patch.object(self.backend, "photo", side_effect=delayed_photo):
                thread.start()
                self.assertTrue(entered.wait(timeout=5))
                self.backend.close()
                resume.set()
                thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], AppError)
            self.assertEqual(errors[0].code, "service_closing")
            self.assertEqual(self.engine.calls, [])
            self.assertFalse(self.backend.render_lock.locked())
        finally:
            resume.set()
            if thread.ident is not None:
                thread.join(timeout=5)

    @unittest.skipUnless(os.name == "posix", "isolated process groups require POSIX")
    def test_close_stops_inflight_worker_and_descendants_and_rolls_back(self):
        unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(20)"], start_new_session=True)
        try:
            for exit_code in (None, 0, 4):
                case = self.root / f"closing-{exit_code}"
                case.mkdir()
                late, leader_ready, child_ready, work_ready = (case / name for name in ("late", "leader", "child", "work"))
                child = ("import os,time; from pathlib import Path; "
                         f"Path({str(child_ready)!r}).write_text(str(os.getpid())); "
                         f"time.sleep(.8); Path({str(late)!r}).write_text('still running')")
                script = ("import os,subprocess,sys,time; from pathlib import Path\n"
                          "output=Path(sys.argv[sys.argv.index('--output')+1]); "
                          "report=Path(sys.argv[sys.argv.index('--report')+1])\n"
                          "output.write_bytes(b'partial PNG'); report.write_text('{}')\n"
                          f"Path({str(work_ready)!r}).write_text(str(output.parent))\n"
                          f"Path({str(leader_ready)!r}).write_text(str(os.getpid()))\n"
                          f"subprocess.Popen([sys.executable,'-c',{child!r}])\n"
                          + ("time.sleep(20)\n" if exit_code is None else f"raise SystemExit({exit_code})\n"))
                (case / "render.py").write_text(script, encoding="utf-8")
                delegate = EngineRunner(root=case, timeout=10)
                backend = BodyBackend(root=case, runner=delegate, platform="darwin")
                photo = backend.import_photo(data=picture())
                source, _ = backend.photo(identifier=photo["photoId"])
                original = source.read_bytes()
                errors, results = [], []

                def render():
                    try:
                        results.append(backend.render(request={"photoId": photo["photoId"], "values": {"StretchLeg": 70}}))
                    except BaseException as error:
                        errors.append(error)

                thread = threading.Thread(target=render)
                thread.start()
                try:
                    deadline = time.monotonic() + 5
                    while not child_ready.is_file() and time.monotonic() < deadline:
                        time.sleep(.01)
                    self.assertTrue(child_ready.is_file(), "the engine descendant must really start")
                    leader_pid, child_pid = int(leader_ready.read_text()), int(child_ready.read_text())
                    self.assertEqual(os.getpgid(child_pid), leader_pid)
                    with self.subTest(leader_exit=exit_code):
                        backend.close()
                        thread.join(timeout=5)
                        self.assertFalse(thread.is_alive())
                        self.assertEqual(results, [])
                        self.assertEqual(len(errors), 1)
                        self.assertIsInstance(errors[0], AppError)
                        self.assertEqual(errors[0].code, "service_closing")
                        self.assertFalse(backend.render_lock.locked())
                        self.assertEqual(source.read_bytes(), original)
                        self.assertFalse(Path(work_ready.read_text()).exists())
                        self.assertEqual(list((backend.state / "renders").iterdir()), [])
                        self.assertEqual(list((backend.state / "receipts").iterdir()), [])
                        with self.assertRaises(AppError) as stopped:
                            backend.render(request={"photoId": photo["photoId"], "values": {"SmallHead": 20}})
                        self.assertEqual(stopped.exception.code, "service_closing")
                        time.sleep(.9)
                        self.assertFalse(late.exists(), "the descendant must not finish after shutdown")
                        self.assertIsNone(unrelated.poll())
                finally:
                    backend.close()
                    thread.join(timeout=5)
        finally:
            unrelated.kill()
            unrelated.wait(timeout=5)

    @unittest.skipUnless(os.name == "posix", "isolated process groups require POSIX")
    def test_timeout_kills_engine_child_group(self):
        marker = self.root / "child-should-not-finish"
        child = f"import time; from pathlib import Path; time.sleep(.5); Path({str(marker)!r}).write_text('alive')"
        script = "import subprocess, sys, time\n" + f"subprocess.Popen([sys.executable, '-c', {child!r}])\ntime.sleep(5)\n"
        (self.root / "render.py").write_text(script, encoding="utf-8")
        photo = self.imported()
        source, _ = self.backend.photo(identifier=photo["photoId"])
        with self.assertRaises(AppError) as error:
            EngineRunner(root=self.root, timeout=.15)(source=source, values={"StretchLeg": 1},
                output=self.root / "unused.png", report=self.root / "unused.json")
        self.assertEqual(error.exception.code, "render_timeout")
        time.sleep(.65)
        self.assertFalse(marker.exists())

    @unittest.skipUnless(os.name == "posix", "isolated process groups require POSIX")
    def test_timeout_kills_descendant_after_parent_exit_without_other_groups(self):
        unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"], start_new_session=True)
        original_popen = subprocess.Popen
        try:
            for exit_code in (0, 4):
                marker = self.root / f"orphan-finished-{exit_code}"
                ready = self.root / f"orphan-ready-{exit_code}"
                child = ("import os, time; from pathlib import Path; "
                         f"Path({str(ready)!r}).write_text(str(os.getpid())); "
                         f"time.sleep(1); Path({str(marker)!r}).write_text('alive')")
                script = ("import subprocess, sys\n"
                          f"subprocess.Popen([sys.executable, '-c', {child!r}])\n"
                          f"raise SystemExit({exit_code})\n")
                (self.root / "render.py").write_text(script, encoding="utf-8")
                processes = []

                def spawn(*args, **kwargs):
                    process = original_popen(*args, **kwargs)
                    processes.append(process)
                    return process

                photo = self.imported()
                source, _ = self.backend.photo(identifier=photo["photoId"])
                with self.subTest(exit_code=exit_code), patch("body.backend.subprocess.Popen", side_effect=spawn):
                    with self.assertRaises(AppError) as error:
                        EngineRunner(root=self.root, timeout=.35)(source=source, values={"StretchLeg": 1},
                            output=self.root / "unused.png", report=self.root / "unused.json")
                    self.assertEqual(error.exception.code, "render_timeout")
                    self.assertEqual(processes[0].returncode, exit_code)
                    self.assertTrue(ready.is_file(), "the pipe-holding child must actually start")
                    self.assertNotEqual(int(ready.read_text()), os.getpid())
                    self.assertIsNone(unrelated.poll())
                    time.sleep(1.05)
                    self.assertFalse(marker.exists())
                    self.assertIsNone(unrelated.poll())
        finally:
            unrelated.kill()
            unrelated.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
