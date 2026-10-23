"""HTTP request safety and the import/render/download user path."""
import http.client
import io
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from body.backend import BodyBackend, image_identity, sha256, write_json
from body.server import BodyHTTPServer


def service_ready_port(*, service, timeout=30):
    deadline = time.monotonic() + timeout
    streams = [service.stdout, service.stderr]
    captured = {service.stdout: b"", service.stderr: b""}
    while streams:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        ready, _, _ = select.select(streams, [], [], remaining)
        if not ready:
            break
        for stream in ready:
            chunk = os.read(stream.fileno(), 8192)
            if not chunk:
                streams.remove(stream)
                continue
            captured[stream] = (captured[stream] + chunk)[-65536:]
        for line in captured[service.stdout].splitlines(keepends=True):
            if not line.endswith(b"\n"):
                continue
            match = re.search(rb"http://127\.0\.0\.1:(\d+)", line)
            if match:
                return int(match[1])
    stdout = captured[service.stdout].decode("utf-8", errors="replace")
    stderr = captured[service.stderr].decode("utf-8", errors="replace")
    raise AssertionError(f"service did not announce readiness within {timeout}s; "
                         f"exit={service.poll()}; stdout={stdout!r}; stderr={stderr!r}")


class ServiceReadinessTests(unittest.TestCase):
    def test_numeric_loopback_binding_and_http_never_resolve_hostnames(self):
        backend = Mock()
        backend.catalog.return_value = {"product": "numeric loopback"}
        server, thread = None, None
        with patch("socket.getfqdn", side_effect=AssertionError("unexpected FQDN lookup")) as fqdn, \
                patch("socket.gethostbyaddr", side_effect=AssertionError("unexpected reverse DNS")) as reverse:
            try:
                server = BodyHTTPServer(address=("127.0.0.1", 0), backend=backend)
                self.assertEqual(server.server_name, "127.0.0.1")
                self.assertEqual(server.server_port, server.server_address[1])
                self.assertGreater(server.server_port, 0)
                thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01), daemon=True)
                thread.start()
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                try:
                    connection.request("GET", "/api/catalog")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"product": "numeric loopback"})
                finally:
                    connection.close()
            finally:
                if server is not None:
                    if thread is not None:
                        server.shutdown()
                    server.server_close()
                if thread is not None:
                    thread.join(timeout=2)
            fqdn.assert_not_called()
            reverse.assert_not_called()

    def test_cold_import_can_take_more_than_five_seconds_without_fixed_sleep(self):
        service = Mock(stdout=Mock(), stderr=Mock())
        service.stdout.fileno.return_value = 11
        service.stderr.fileno.return_value = 12
        clock = {"now": 0}
        waits = []

        def select_streams(_read, _write, _errors, timeout):
            waits.append(timeout)
            clock["now"] += 6
            return ([service.stderr] if len(waits) == 1 else [service.stdout]), [], []

        def read(descriptor, _size):
            return b"cold dependency import\n" if descriptor == 12 else "独立美体图片版：http://127.0.0.1:5270\n".encode("utf-8")

        with patch("body.tests.test_server.time.monotonic", side_effect=lambda: clock["now"]), \
                patch("body.tests.test_server.select.select", side_effect=select_streams), \
                patch("body.tests.test_server.os.read", side_effect=read):
            self.assertEqual(service_ready_port(service=service), 5270)
        self.assertEqual(waits, [30, 24])
        self.assertEqual(clock["now"], 12)

    def test_timeout_includes_utf8_stderr_for_diagnosis(self):
        service = Mock(stdout=Mock(), stderr=Mock())
        service.stderr.fileno.return_value = 12
        service.poll.return_value = 1
        clock = {"now": 0}

        def select_streams(_read, _write, _errors, _timeout):
            clock["now"] = 31
            return [service.stderr], [], []

        with patch("body.tests.test_server.time.monotonic", side_effect=lambda: clock["now"]), \
                patch("body.tests.test_server.select.select", side_effect=select_streams), \
                patch("body.tests.test_server.os.read", return_value="依赖导入失败\n".encode("utf-8")):
            with self.assertRaises(AssertionError) as error:
                service_ready_port(service=service)
        self.assertIn("within 30s", str(error.exception))
        self.assertIn("exit=1", str(error.exception))
        self.assertIn("依赖导入失败", str(error.exception))


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        (root / "web").mkdir()
        (root / "web" / "index.html").write_text("<!doctype html><title>美体</title>", encoding="utf-8")
        write_json(path=root / "catalog.json", value={"product": "test", "controls": []})

        def engine(*, source, values, output, report):
            with Image.open(source) as original:
                image = original.convert("RGBA")
            before = image_identity(image=image)["rgbaSha256"]
            image.putpixel((0, 0), (255, 0, 0, 255))
            image.save(output, format="PNG")
            write_json(path=report, value={"inputRgbaSha256": before,
                "outputRgbaSha256": image_identity(image=image)["rgbaSha256"],
                "inputPngSha256": sha256(data=source.read_bytes()),
                "outputPngSha256": sha256(data=output.read_bytes()), "controls": values,
                "parts": {"StretchLeg": {"moved": True}},
                "independence": {"private_native_images": []}})

        self.backend = BodyBackend(root=root, runner=engine, platform="darwin")
        self.server = BodyHTTPServer(address=("127.0.0.1", 0), backend=self.backend)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.01), daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, *, method="GET", path="/api/catalog", data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, path, body=data, headers=headers or {})
        response = connection.getresponse()
        value = response.read()
        status, response_headers = response.status, dict(response.getheaders())
        connection.close()
        return status, response_headers, value

    def upload(self):
        stream = io.BytesIO()
        Image.new("RGB", (32, 48), (90, 110, 120)).save(stream, format="PNG")
        status, _, data = self.request(method="POST", path="/api/photos", data=stream.getvalue(), headers={"Content-Type": "image/png"})
        self.assertEqual(status, 200)
        return json.loads(data)

    def test_catalog_and_static_root(self):
        status, headers, data = self.request()
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(data)["platform"]["supported"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["X-Independent-Body-Instance"], self.server.instance_id)
        self.assertIn("img-src 'self' blob: data:", headers["Content-Security-Policy"])
        status, _, data = self.request(path="/")
        self.assertEqual(status, 200)
        self.assertIn("美体".encode(), data)

    def test_import_render_and_download_real_http(self):
        photo = self.upload()
        status, _, data = self.request(method="POST", path="/api/render",
            data=json.dumps({"photoId": photo["photoId"], "values": {"StretchLeg": 75}}),
            headers={"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        result = json.loads(data)
        self.assertEqual(result["status"], "applied")
        status, _, original = self.request(path=photo["url"])
        self.assertEqual(status, 200)
        status, headers, output = self.request(path=result["result"]["downloadUrl"])
        self.assertEqual(status, 200)
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertNotEqual(original, output)
        status, _, receipt = self.request(path=result["receiptUrl"])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(receipt)["inputRgbaSha256"], photo["rgbaSha256"])

    def test_unregistered_files_and_traversal_not_served(self):
        for path in ("/catalog.json", "/.state/photos", "/../catalog.json", "/%2e%2e/catalog.json",
                     "/api/photos/" + "0" * 32 + ".png", "/api/receipts/" + "0" * 32 + ".png"):
            with self.subTest(path=path):
                status, _, data = self.request(path=path)
                self.assertEqual(status, 404)
                self.assertIn("message", json.loads(data)["error"])

    def test_cross_site_and_invalid_host_rejected(self):
        for headers in ({"Origin": "https://example.com"}, {"Host": "example.com"}):
            status, _, _ = self.request(headers=headers)
            self.assertEqual(status, 403)

    def test_same_origin_requests_accepted(self):
        status, _, _ = self.request(headers={"Origin": f"http://127.0.0.1:{self.server.server_port}"})
        self.assertEqual(status, 200)

    def test_bad_json_duplicate_keys_and_nonfinite_rejected(self):
        for data in (b"{", b"\xff", b'{"photoId":"a","photoId":"b","values":{}}', b'{"values":{"SmallHead":NaN}}'):
            status, _, value = self.request(method="POST", path="/api/render", data=data,
                                            headers={"Content-Type": "application/json"})
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(value)["error"]["code"], "invalid_json")

    def test_stale_photo_and_invalid_controls(self):
        status, _, _ = self.request(method="POST", path="/api/render",
            data=json.dumps({"photoId": "0" * 32, "values": {}}), headers={"Content-Type": "application/json"})
        self.assertEqual(status, 404)
        photo = self.upload()
        status, _, _ = self.request(method="POST", path="/api/render",
            data=json.dumps({"photoId": photo["photoId"], "values": {"native": 100}}), headers={"Content-Type": "application/json"})
        self.assertEqual(status, 400)

    def test_render_content_type_and_invalid_image(self):
        status, _, _ = self.request(method="POST", path="/api/render", data=b"{}", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)
        status, _, _ = self.request(method="POST", path="/api/photos", data=b"invalid", headers={"Content-Type": "image/png"})
        self.assertEqual(status, 422)

    def test_declared_oversize_rejected_before_body_read(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/photos", body=b"x", headers={"Content-Length": str(20 * 1024 * 1024 + 1)})
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        connection.close()

    def test_server_failure_has_no_traceback_or_system_path(self):
        def fail(*, source, values, output, report):
            raise RuntimeError("sensitive /private/test traceback")
        self.backend.runner = fail
        photo = self.upload()
        status, _, data = self.request(method="POST", path="/api/render",
            data=json.dumps({"photoId": photo["photoId"], "values": {"StretchLeg": 50}}),
            headers={"Content-Type": "application/json"})
        self.assertEqual(status, 500)
        self.assertNotIn(b"/private", data)
        self.assertNotIn(b"traceback", data)
        self.assertFalse(self.backend.render_lock.locked())

    @unittest.skipUnless(os.name == "posix", "controlled worker groups require POSIX")
    def test_sigterm_rolls_back_inflight_request_and_stops_its_worker_group(self):
        root = Path(self.temporary.name) / "shutdown-service"
        root.mkdir()
        write_json(path=root / "catalog.json", value={"controls": []})
        marker = root / "workers.json"
        (root / "render.py").write_text(
            "import json, os, subprocess, sys, time\nfrom pathlib import Path\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
            f"Path({str(marker)!r}).write_text(json.dumps([os.getpid(), child.pid]))\n"
            "time.sleep(30)\n")
        code = (
            "import faulthandler\nfaulthandler.dump_traceback_later(15)\n"
            "from pathlib import Path\nimport sys\nfrom body import server\n"
            "from body.backend import BodyBackend, EngineRunner\n"
            f"fixture = Path({str(root)!r})\n"
            "server.BodyBackend = lambda **_: BodyBackend(root=fixture, runner=EngineRunner(root=fixture), platform='darwin')\n"
            "actual_server = server.BodyHTTPServer\n"
            "class ReadyServer(actual_server):\n"
            "    def __init__(self, **options):\n"
            "        super().__init__(**options)\n"
            "        faulthandler.cancel_dump_traceback_later()\n"
            "server.BodyHTTPServer = ReadyServer\n"
            "sys.argv = ['server.py', '--port', '0']\nserver.main()\n")
        service = subprocess.Popen([sys.executable, "-B", "-c", code],
            cwd=Path(__file__).resolve().parents[2], start_new_session=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, "PYTHONIOENCODING": "ascii"})
        worker_ids = []
        request_thread = None
        try:
            port = service_ready_port(service=service)
            stream = io.BytesIO()
            Image.new("RGB", (32, 48), "gray").save(stream, format="PNG")
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request("POST", "/api/photos", stream.getvalue(), {"Content-Type": "image/png"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            photo = json.loads(response.read())
            connection.close()

            def render_request():
                client = http.client.HTTPConnection("127.0.0.1", port, timeout=8)
                try:
                    client.request("POST", "/api/render", json.dumps({"photoId": photo["photoId"],
                        "values": {"StretchLeg": 100}}), {"Content-Type": "application/json"})
                    reply = client.getresponse()
                    reply.read()
                except (OSError, http.client.HTTPException):
                    pass
                finally:
                    client.close()

            request_thread = threading.Thread(target=render_request, daemon=True)
            request_thread.start()
            deadline = time.monotonic() + 5
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(marker.exists(), "controlled renderer did not start")
            worker_ids = json.loads(marker.read_text())
            service.send_signal(signal.SIGTERM)
            service.communicate(timeout=8)
            self.assertEqual(service.returncode, 0)
            request_thread.join(timeout=2)
            self.assertFalse(request_thread.is_alive())
            for pid in worker_ids:
                state = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True)
                self.assertTrue(state.returncode != 0 or state.stdout.strip().startswith("Z"), f"worker {pid} survived shutdown")
            self.assertEqual(list((root / ".state/renders").iterdir()), [])
            self.assertEqual(list((root / ".state/receipts").iterdir()), [])
            self.assertTrue((root / ".state/photos" / f"{photo['photoId']}.png").is_file())
        finally:
            for pid in worker_ids[:1]:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if service.poll() is None:
                service.kill()
            service.communicate(timeout=5)
            if request_thread:
                request_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
