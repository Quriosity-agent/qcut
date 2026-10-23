"""Observe the launching process without signalling a possibly reused process ID."""
import ctypes
import os
import sys
import threading


class ParentWatch:
    def __init__(self, *, pid, on_exit):
        self.pid, self.on_exit = pid, on_exit
        self.stop = threading.Event()
        self.kernel, self.handle = None, None
        if sys.platform == "win32":
            from ctypes import wintypes
            self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            self.kernel.OpenProcess.restype = wintypes.HANDLE
            self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            self.kernel.WaitForSingleObject.restype = wintypes.DWORD
            self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            self.kernel.CloseHandle.restype = wintypes.BOOL
            self.handle = self.kernel.OpenProcess(0x00100000, False, pid)
            if not self.handle:
                raise OSError("launching process is unavailable")
        if not self.alive():
            self.close()
            raise OSError("launching process has exited")
        self.thread = threading.Thread(target=self._run, name="body-photo-parent", daemon=True)
        self.thread.start()

    def alive(self):
        if self.kernel is None:
            return os.getppid() == self.pid
        result = self.kernel.WaitForSingleObject(self.handle, 0)
        if result not in (0, 0x102):
            raise OSError("cannot observe launching process")
        return result == 0x102

    def _run(self):
        while not self.stop.wait(0.2):
            try:
                alive = self.alive()
            except OSError:
                alive = False
            if not alive:
                self.on_exit()
                return

    def close(self):
        self.stop.set()
        thread = getattr(self, "thread", None)
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=1)
        if self.handle is not None:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
