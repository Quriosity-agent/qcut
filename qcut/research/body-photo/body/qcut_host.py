"""QCut lifecycle adapter for the unchanged standalone photo HTTP interface."""
import argparse
import importlib
import json
import os
from pathlib import Path
import re
import signal
import sys

sys.dont_write_bytecode = True

from runtime_paths import RUNTIME_ENV, runtime_root


BODY_ROOT = Path(__file__).resolve().parent
DEPENDENCIES = {"numpy": "2.5.3", "Pillow": "12.2.0", "onnx": "1.19.0",
                "onnxruntime": "1.22.1"}


def verify_environment():
    if not os.environ.get(RUNTIME_ENV):
        raise ValueError("QCUT_BODY_PHOTO_RUNTIME_ROOT must name the external private runtime")
    runtime_root(body_root=BODY_ROOT)
    versions = {}
    for package, expected in DEPENDENCIES.items():
        module = importlib.import_module("PIL" if package == "Pillow" else package)
        versions[package] = module.__version__
        if versions[package] != expected:
            raise ValueError("body photo dependency mismatch: " + package + " requires " + expected)
    from render import verify_installation
    return {**verify_installation(backend="cpu"), "type": "verified", "verified": True,
            "onnxruntime": versions["onnxruntime"], "dependencies": versions}


def state_path(*, text):
    state = Path(text)
    if not state.is_absolute() or any(parent.is_symlink() for parent in (state, *state.parents)):
        raise ValueError("owned state must be an absolute directory without symlinks")
    resolved = state.resolve()
    for protected in (BODY_ROOT, runtime_root(body_root=BODY_ROOT)):
        if resolved.is_relative_to(protected.resolve()) or protected.resolve().is_relative_to(resolved):
            raise ValueError("owned state must be separate from application sources and runtime")
    return state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--state")
    parser.add_argument("--instance")
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()
    os.environ["QCUT_BODY_PHOTO_CPU"] = "1"
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    os.environ["PYTHONNOUSERSITE"] = "1"
    verification = verify_environment()
    if args.verify:
        print(json.dumps(verification, separators=(",", ":")), flush=True)
        return
    if not args.state or not args.instance or re.fullmatch("[0-9a-f]{32}", args.instance) is None:
        raise ValueError("owned state and a 32-character lowercase hex instance are required")
    if args.parent_pid is not None and args.parent_pid <= 0:
        raise ValueError("positive parent process ID required")
    from backend import BodyBackend
    from server import BodyHTTPServer
    from qcut_parent import ParentWatch
    os.environ["QCUT_BODY_PHOTO_HOST_PID"] = str(os.getpid())
    backend = BodyBackend(root=BODY_ROOT, platform=sys.platform, state=state_path(text=args.state))
    server, watch = None, None
    previous = {}
    try:
        server = BodyHTTPServer(address=("127.0.0.1", 0), backend=backend, instance_id=args.instance)
        if args.parent_pid is not None:
            watch = ParentWatch(pid=args.parent_pid, on_exit=server.shutdown)
        def stop_service(_number, _frame):
            raise KeyboardInterrupt
        for number in (signal.SIGTERM, signal.SIGINT):
            previous[number] = signal.signal(number, stop_service)
        print(json.dumps({"type": "ready", "port": server.server_port,
                          "instance": server.instance_id, "backend": "portable-CPU"}), flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        except KeyboardInterrupt:
            pass
    finally:
        if watch is not None:
            watch.close()
        if server is not None:
            server.server_close()
        else:
            backend.close()
        for number, handler in previous.items():
            signal.signal(number, handler)


if __name__ == "__main__":
    main()
