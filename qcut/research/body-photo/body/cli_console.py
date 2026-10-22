"""Use UTF-8 for body command output without replacing caller-owned streams."""
import sys


def configure_console():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")
