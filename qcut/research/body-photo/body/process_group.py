"""Owned renderer process trees, including descendants whose leader has exited."""
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading


WINDOWS_BOOTSTRAP = (
    "import runpy,sys\n"
    "if sys.stdin.buffer.read(1) != b'1': raise SystemExit(125)\n"
    "sys.argv=sys.argv[1:]\n"
    "runpy.run_path(sys.argv[0],run_name='__main__')\n"
)


class WindowsJob:
    def __init__(self):
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [
                ("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                ("flags", wintypes.DWORD), ("minimum_working_set", ctypes.c_size_t),
                ("maximum_working_set", ctypes.c_size_t), ("active_process_limit", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority_class", wintypes.DWORD),
                ("scheduling_class", wintypes.DWORD),
            ]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in (
                "read_operations", "write_operations", "other_operations",
                "read_bytes", "write_bytes", "other_bytes")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [
                ("basic", BasicLimits), ("io", IoCounters),
                ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t),
            ]

        self._lock = threading.Lock()
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                        ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE includes orphan descendants.
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, *, process):
        if not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        with self._lock:
            if self.handle:
                handle, self.handle = self.handle, None
                if not self.kernel.CloseHandle(handle):
                    raise ctypes.WinError(ctypes.get_last_error())


def spawn(*, command, cwd, environment):
    if environment.get("QCUT_BODY_PHOTO_HOST_PID"):
        command = [command[0], str(Path(__file__).with_name("qcut_render.py")), *command[1:]]
    if sys.platform != "win32":
        return subprocess.Popen(command, cwd=cwd, env=environment, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, start_new_session=True)
    job, process = WindowsJob(), None
    try:
        process = subprocess.Popen([command[0], "-c", WINDOWS_BOOTSTRAP, *command[1:]],
            cwd=cwd, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, creationflags=0x00000200)
        # The Python bootstrap cannot spawn children until its entire tree belongs to the job.
        job.assign(process=process)
        process._body_job = job
        process.stdin.write(b"1")
        process.stdin.flush()
        process.stdin.close()
        process.stdin = None
        return process
    except BaseException:
        job.close()
        if process is not None:
            process.kill()
            process.communicate(timeout=5)
        raise


def kill(*, process):
    job = getattr(process, "_body_job", None)
    if job is not None:
        job.close()
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def release(*, process):
    job = getattr(process, "_body_job", None)
    if job is not None:
        job.close()
