"""Portable process ownership and Windows renderer lifecycle contracts."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from body import process_group
from body.backend import AppError, BodyBackend, EngineRunner
from body.tests.test_backend import FakeEngine, picture


class PortableBackendTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="portable-body-backend-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "catalog.json").write_text('{"controls":[]}', encoding="utf-8")
        self.engine = FakeEngine()

    def test_each_supported_platform_executes_nonzero_requests(self):
        with patch.dict(os.environ, {"BODY_RENDER_BACKEND": "auto"}):
            for platform, label in (("darwin", "macOS-Metal"), ("linux", "portable-CPU"), ("win32", "portable-CPU")):
                with self.subTest(platform=platform):
                    backend = BodyBackend(root=self.root, runner=self.engine, platform=platform)
                    self.assertEqual(backend.catalog()["platform"]["backend"], label)
                    self.assertTrue(backend.catalog()["platform"]["supported"])
                    photo = backend.import_photo(data=picture())
                    result = backend.render(request={"photoId": photo["photoId"], "values": {"SlimWaist": 50}})
                    self.assertEqual(result["status"], "applied")
                    self.assertTrue(result["controls"]["SlimWaist"]["applied"])
                    self.assertNotEqual(result["result"]["rgbaSha256"], photo["rgbaSha256"])
        self.assertEqual(len(self.engine.calls), 3)

    def test_explicit_cpu_works_on_mac_and_invalid_config_fails_closed(self):
        backend = BodyBackend(root=self.root, runner=self.engine, platform="darwin")
        with patch.dict(os.environ, {"BODY_RENDER_BACKEND": "cpu"}):
            self.assertEqual(backend.catalog()["platform"]["backend"], "portable-CPU")
        with patch.dict(os.environ, {"BODY_RENDER_BACKEND": "unknown"}):
            self.assertFalse(backend.catalog()["platform"]["supported"])
            photo = backend.import_photo(data=picture())
            result = backend.render(request={"photoId": photo["photoId"], "values": {"SlimWaist": 20}})
            self.assertEqual(result["status"], "unavailable")
            self.assertEqual(result["result"]["rgbaSha256"], photo["rgbaSha256"])
        self.assertEqual(self.engine.calls, [])

    def test_windows_and_linux_reject_forced_metal(self):
        for platform in ("linux", "win32"):
            with self.subTest(platform=platform), patch.dict(os.environ, {"BODY_RENDER_BACKEND": "metal"}):
                backend = BodyBackend(root=self.root, runner=self.engine, platform=platform)
                self.assertFalse(backend.catalog()["platform"]["supported"])

    def test_runner_preserves_backend_env_and_cli_auto_route(self):
        script = (
            "import json,os,sys\nfrom pathlib import Path\n"
            "output=Path(sys.argv[sys.argv.index('--output')+1])\n"
            "receipt=Path(sys.argv[sys.argv.index('--report')+1])\n"
            "output.write_bytes(b'fake-render-for-process-contract')\n"
            "receipt.write_text(json.dumps({'backend':os.environ.get('BODY_RENDER_BACKEND'),'argv':sys.argv}))\n"
        )
        (self.root / "render.py").write_text(script, encoding="utf-8")
        runner = EngineRunner(root=self.root)
        output, receipt = self.root / "out.png", self.root / "out.json"
        with patch.dict(os.environ, {"BODY_RENDER_BACKEND": "cpu"}):
            runner(source=self.root / "source.png", values={"SlimWaist": 20}, output=output, report=receipt)
        saved = json.loads(receipt.read_text())
        self.assertEqual(saved["backend"], "cpu")
        self.assertNotIn("--backend", saved["argv"])
        self.assertEqual(runner._active, {})


class ProcessGroupTests(unittest.TestCase):
    def test_posix_spawn_keeps_existing_session_and_pipe_contract(self):
        with patch.object(process_group.sys, "platform", "linux"), \
                patch.object(process_group.subprocess, "Popen") as popen:
            process_group.spawn(command=["python", "render.py"], cwd="/owned", environment={"BODY": "yes"})
        popen.assert_called_once_with(["python", "render.py"], cwd="/owned", env={"BODY": "yes"},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)

    def test_windows_job_assignment_precedes_bootstrap_release(self):
        events = []
        job = Mock()
        process = Mock()
        stream = process.stdin
        job.assign.side_effect = lambda **_: events.append("assigned")
        stream.write.side_effect = lambda *_: events.append("released")
        with patch.object(process_group.sys, "platform", "win32"), \
                patch.object(process_group, "WindowsJob", return_value=job), \
                patch.object(process_group.subprocess, "Popen", return_value=process) as popen:
            result = process_group.spawn(command=["python", "render.py", "--verify"], cwd="owned",
                                         environment={})
        self.assertIs(result, process)
        self.assertEqual(events, ["assigned", "released"])
        self.assertEqual(popen.call_args.args[0], ["python", "-c", process_group.WINDOWS_BOOTSTRAP,
                                                  "render.py", "--verify"])
        self.assertEqual(popen.call_args.kwargs["creationflags"], 0x200)
        self.assertNotIn("start_new_session", popen.call_args.kwargs)
        stream.write.assert_called_once_with(b"1")
        stream.close.assert_called_once()
        self.assertIsNone(process.stdin)
        process_group.kill(process=process)
        job.close.assert_called_once()

    def test_failed_windows_assignment_never_releases_renderer(self):
        job, process = Mock(), Mock()
        stream = process.stdin
        job.assign.side_effect = OSError("job assignment refused")
        with patch.object(process_group.sys, "platform", "win32"), \
                patch.object(process_group, "WindowsJob", return_value=job), \
                patch.object(process_group.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(OSError, "assignment refused"):
                process_group.spawn(command=["python", "render.py"], cwd="owned", environment={})
        stream.write.assert_not_called()
        job.close.assert_called_once()
        process.kill.assert_called_once()
        process.communicate.assert_called_once_with(timeout=5)

    def test_failed_windows_spawn_closes_job(self):
        job = Mock()
        with patch.object(process_group.sys, "platform", "win32"), \
                patch.object(process_group, "WindowsJob", return_value=job), \
                patch.object(process_group.subprocess, "Popen", side_effect=OSError("spawn failed")):
            with self.assertRaisesRegex(OSError, "spawn failed"):
                process_group.spawn(command=["python", "render.py"], cwd="owned", environment={})
        job.close.assert_called_once()

    def test_job_release_also_closes_after_normal_completion(self):
        process = Mock()
        process_group.release(process=process)
        process._body_job.close.assert_called_once()


@unittest.skipUnless(sys.platform == "win32", "actual Windows Job Object execution")
class WindowsProcessLifecycleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="body-windows-job-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.unrelated = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"])
        self.addCleanup(self.stop_unrelated)

    def stop_unrelated(self):
        if self.unrelated.poll() is None:
            self.unrelated.kill()
        self.unrelated.wait(timeout=5)

    def write_worker(self, *, exit_code):
        late, ready = self.root / f"late-{exit_code}", self.root / f"ready-{exit_code}"
        child = ("import os,time;from pathlib import Path;"
                 f"Path({str(ready)!r}).write_text(str(os.getpid()));"
                 f"time.sleep(2);Path({str(late)!r}).write_text('unowned')")
        script = f"import subprocess,sys,time\nsubprocess.Popen([sys.executable,'-c',{child!r}])\n"
        script += "time.sleep(30)\n" if exit_code is None else f"raise SystemExit({exit_code})\n"
        (self.root / "render.py").write_text(script, encoding="utf-8")
        return ready, late

    def test_timeout_kills_descendants_even_after_leader_exits(self):
        for exit_code in (None, 0, 4):
            with self.subTest(exit_code=exit_code):
                ready, late = self.write_worker(exit_code=exit_code)
                runner = EngineRunner(root=self.root, timeout=1)
                with self.assertRaises(AppError) as error:
                    runner(source=self.root / "source.png", values={"SlimWaist": 20},
                           output=self.root / "out.png", report=self.root / "out.json")
                self.assertEqual(error.exception.code, "render_timeout")
                self.assertTrue(ready.is_file(), "descendant must actually have started")
                time.sleep(2.1)
                self.assertFalse(late.exists())
                self.assertIsNone(self.unrelated.poll())
                self.assertEqual(runner._active, {})

    def test_close_stops_active_windows_tree(self):
        ready, late = self.write_worker(exit_code=0)
        runner = EngineRunner(root=self.root, timeout=20)
        errors = []

        def render():
            try:
                runner(source=self.root / "source.png", values={"SlimWaist": 20},
                       output=self.root / "out.png", report=self.root / "out.json")
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=render)
        thread.start()
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(ready.is_file())
            runner.close()
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], AppError)
            self.assertEqual(errors[0].code, "service_closing")
            time.sleep(2.1)
            self.assertFalse(late.exists())
            self.assertIsNone(self.unrelated.poll())
        finally:
            runner.close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
