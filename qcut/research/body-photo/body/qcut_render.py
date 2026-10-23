"""Keep the isolated renderer tree owned even if its HTTP host crashes."""
import os
from pathlib import Path
import runpy
import signal
import sys

sys.dont_write_bytecode = True

from qcut_parent import ParentWatch


def stop_tree():
    if sys.platform == "win32":
        os._exit(125)
    os.killpg(os.getpgrp(), signal.SIGKILL)


def main():
    expected = Path(__file__).with_name("render.py").resolve()
    if len(sys.argv) < 2 or Path(sys.argv[1]).resolve() != expected:
        raise ValueError("only the bundled renderer can be launched")
    parent = int(os.environ["QCUT_BODY_PHOTO_HOST_PID"])
    watch = ParentWatch(pid=parent, on_exit=stop_tree)
    sys.argv = sys.argv[1:]
    try:
        runpy.run_path(str(expected), run_name="__main__")
    finally:
        watch.close()


if __name__ == "__main__":
    main()
