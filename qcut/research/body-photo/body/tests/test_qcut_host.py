"""QCut source/runtime boundaries and renderer process ownership without models."""
import importlib
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import qcut_host
from qcut_parent import ParentWatch
from runtime_paths import RUNTIME_ENV, runtime_root


class RuntimeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="qcut-photo-host-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def test_explicit_external_root_is_required_by_the_host(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "must name the external"):
                qcut_host.verify_environment()

    def test_runtime_adapter_keeps_data_external_and_rejects_missing_relative_or_symlink(self):
        for text in ("relative", str(self.root / "missing")):
            with self.subTest(path=text), patch.dict(os.environ, {RUNTIME_ENV: text}):
                with self.assertRaisesRegex(ValueError, "existing absolute"):
                    runtime_root(body_root=self.root / "source")
        with patch.dict(os.environ, {RUNTIME_ENV: str(self.root)}):
            self.assertEqual(runtime_root(body_root=self.root / "source"), self.root)
        link = self.root / "link"
        link.symlink_to(self.root, target_is_directory=True)
        with patch.dict(os.environ, {RUNTIME_ENV: str(link)}):
            with self.assertRaisesRegex(ValueError, "symlink"):
                runtime_root(body_root=self.root / "source")

    def test_dependency_versions_are_exact_before_any_model_verification(self):
        modules = {name: SimpleNamespace(__version__=version)
                   for name, version in qcut_host.DEPENDENCIES.items()}
        modules["numpy"].__version__ = "0.0.0"
        with patch.dict(os.environ, {RUNTIME_ENV: str(self.root)}), \
                patch.object(importlib, "import_module", side_effect=lambda name: modules[name]):
            with self.assertRaisesRegex(ValueError, "numpy requires"):
                qcut_host.verify_environment()

    def test_state_cannot_alias_application_or_private_runtime(self):
        runtime = self.root / "runtime"
        runtime.mkdir()
        with patch.dict(os.environ, {RUNTIME_ENV: str(runtime)}):
            for state in (runtime, runtime / "state", self.root, qcut_host.BODY_ROOT / "state"):
                with self.subTest(path=state), self.assertRaisesRegex(ValueError, "separate"):
                    qcut_host.state_path(text=str(state))
            self.assertEqual(qcut_host.state_path(text=str(self.root / "state")), self.root / "state")

    @unittest.skipIf(sys.platform == "win32", "POSIX parent identity")
    def test_parent_watch_rejects_a_process_other_than_the_actual_parent(self):
        with self.assertRaisesRegex(OSError, "exited"):
            ParentWatch(pid=os.getpid(), on_exit=lambda: None)


@unittest.skipIf(sys.platform == "win32", "Windows trees use kill-on-close jobs")
class RenderOwnershipTests(unittest.TestCase):
    def test_abrupt_host_death_kills_the_isolated_render_and_its_child(self):
        with tempfile.TemporaryDirectory(prefix="qcut-photo-owner-") as temporary:
            root = Path(temporary)
            for name in ("qcut_render.py", "qcut_parent.py"):
                (root / name).write_bytes((qcut_host.BODY_ROOT / name).read_bytes())
            (root / "render.py").write_text(
                "import subprocess,sys,time\n"
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\n"
                "print(child.pid,flush=True)\n"
                "time.sleep(60)\n")
            driver = (
                "import os,subprocess,sys,time\n"
                "os.environ['QCUT_BODY_PHOTO_HOST_PID']=str(os.getpid())\n"
                "p=subprocess.Popen([sys.executable,'-B',sys.argv[1],sys.argv[2]],start_new_session=True)\n"
                "print(p.pid,flush=True)\n"
                "time.sleep(60)\n")
            host = subprocess.Popen([sys.executable, "-B", "-c", driver,
                                     str(root / "qcut_render.py"), str(root / "render.py")],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            group = None
            try:
                group = int(host.stdout.readline())
                child = int(host.stdout.readline())
                os.kill(host.pid, signal.SIGKILL)
                host.wait(timeout=5)
                deadline = time.monotonic() + 5
                alive = True
                while time.monotonic() < deadline:
                    # A zombie has exited and cannot retain a model or execute work.
                    status = subprocess.run(["ps", "-o", "stat=", "-p", str(child)],
                                            capture_output=True, text=True, check=False).stdout.strip()
                    alive = bool(status) and not status.startswith("Z")
                    if not alive:
                        break
                    time.sleep(0.05)
                self.assertFalse(alive, "render descendant survived abrupt host death")
                _, error = host.communicate(timeout=5)
                self.assertEqual(error, "")
            finally:
                if host.poll() is None:
                    host.kill()
                if group is not None:
                    try:
                        os.killpg(group, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                host.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
