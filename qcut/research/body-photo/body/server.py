"""Loopback HTTP interface for the standalone body photo product."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import signal
from socketserver import TCPServer
from urllib.parse import urlsplit
import uuid

try:
    from .backend import AppError, BodyBackend, MAX_FILE_BYTES
    from .cli_console import configure_console
except ImportError:
    from backend import AppError, BodyBackend, MAX_FILE_BYTES
    from cli_console import configure_console


MAX_JSON_BYTES = 64 * 1024
STATIC_FILES = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js",
                "/body-controller.js": "body-controller.js", "/styles.css": "styles.css",
                "/edits-contract.js": "edits-contract.js", "/local-editor.js": "local-editor.js",
                "/local-editor.css": "local-editor.css", "/glute-editor.js": "glute-editor.js",
                "/glute-contract.js": "glute-contract.js"}
ASSET_PATH = re.compile(r"/api/(photos|renders|download|receipts)/([0-9a-f]{32})\.(png|json)\Z")


def parse_json(*, data):
    def no_duplicates(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise ValueError("duplicate object key")
            result[name] = value
        return result

    def no_constant(value):
        raise ValueError("nonfinite JSON")

    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=no_duplicates, parse_constant=no_constant)
    except (UnicodeDecodeError, ValueError) as error:
        raise AppError(message="请求内容不是有效的 JSON。", code="invalid_json") from error


class BodyHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *, address, backend, instance_id=None):
        self.instance_id = uuid.uuid4().hex if instance_id is None else instance_id
        if not isinstance(self.instance_id, str) or not re.fullmatch(r"[0-9a-f]{32}", self.instance_id):
            raise ValueError("BODY_INSTANCE_ID 必须是 32 位十六进制启动编号。")
        self.backend = backend
        super().__init__(address, BodyHandler)

    def server_bind(self):
        # Numeric loopback binding must not wait on the machine's reverse DNS resolver.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]

    def server_close(self):
        try:
            self.backend.close()
        finally:
            super().server_close()


class BodyHandler(BaseHTTPRequestHandler):
    server_version = "IndependentBody/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(150)

    def _send(self, *, status, content, content_type, attachment=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Independent-Body-Instance", self.server.instance_id)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        if attachment:
            self.send_header("Content-Disposition", 'attachment; filename="body-result.png"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def _json(self, *, value, status=200):
        self._send(status=status, content=json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                   content_type="application/json; charset=utf-8")

    def _error(self, *, error):
        self._json(status=error.status, value={"error": {"code": error.code, "message": error.message}, "message": error.message})

    def _check_request(self):
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if host not in allowed:
            raise AppError(message="请通过本机 127.0.0.1 地址访问。", code="invalid_host", status=403)
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{name}" for name in allowed}:
            raise AppError(message="请在美体应用页面中提交请求。", code="invalid_origin", status=403)

    def _body(self, *, limit):
        if self.headers.get("Transfer-Encoding"):
            raise AppError(message="此接口需要明确的请求长度。")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None or not raw_length.isdigit():
            raise AppError(message="请求缺少有效的内容长度。", status=411)
        length = int(raw_length)
        if not 0 < length <= limit:
            raise AppError(message="请求过大或内容为空，请缩小文件后重试。", code="request_size", status=413)
        data = self.rfile.read(length)
        if len(data) != length:
            raise AppError(message="上传未完成，请重新导入照片。")
        return data

    def do_GET(self):
        try:
            self._check_request()
            path = urlsplit(self.path).path
            if path == "/api/catalog":
                self._json(value=self.server.backend.catalog())
                return
            match = ASSET_PATH.fullmatch(path)
            if match:
                category, identifier, suffix = match.groups()
                if suffix != ("json" if category == "receipts" else "png"):
                    raise AppError(message="找不到这个地址。", code="not_found", status=404)
                file = self.server.backend.stored_file(category=category, identifier=identifier)
                self._send(status=200, content=file.read_bytes(), content_type="application/json; charset=utf-8" if suffix == "json" else "image/png",
                           attachment=category == "download")
                return
            if path in STATIC_FILES:
                file = self.server.backend.root / "web" / STATIC_FILES[path]
                if file.is_file() and not file.is_symlink():
                    self._send(status=200, content=file.read_bytes(),
                               content_type=(mimetypes.guess_type(file.name)[0] or "application/octet-stream") + "; charset=utf-8")
                    return
            raise AppError(message="找不到这个地址。", code="not_found", status=404)
        except AppError as error:
            self._error(error=error)
        except (OSError, ValueError):
            self._error(error=AppError(message="读取文件失败，请重新导入后重试。", code="read_failed", status=500))

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        try:
            self._check_request()
            path = urlsplit(self.path).path
            if path == "/api/photos":
                value = self.server.backend.import_photo(data=self._body(limit=MAX_FILE_BYTES))
            elif path == "/api/render":
                if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                    raise AppError(message="处理接口需要 application/json 请求。", status=415)
                value = self.server.backend.render(request=parse_json(data=self._body(limit=MAX_JSON_BYTES)))
            else:
                raise AppError(message="找不到这个接口。", code="not_found", status=404)
            self._json(value=value)
        except AppError as error:
            self.close_connection = True
            self._error(error=error)
        except Exception:
            self.close_connection = True
            self._error(error=AppError(message="处理未能完成，请重新导入照片并检查本地运行环境。", code="internal_error", status=500))


def stop_service(_signum, _frame):
    raise KeyboardInterrupt


def main():
    configure_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5270)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port 必须在 0 到 65535 之间")
    server = BodyHTTPServer(address=("127.0.0.1", args.port), backend=BodyBackend(root=Path(__file__).parent),
                            instance_id=os.environ.get("BODY_INSTANCE_ID"))
    previous_term_handler = signal.signal(signal.SIGTERM, stop_service)
    print(f"独立美体图片版：http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        finally:
            signal.signal(signal.SIGTERM, previous_term_handler)


if __name__ == "__main__":
    main()
