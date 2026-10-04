"""Campaign deadlines and output budgets; shared ProcessTree owns cleanup."""
from __future__ import annotations

from contextlib import contextmanager
import signal
import subprocess
import time

from face_native_process import ProcessTree


def output_budget(*, directory, maximum=2 * 1024**3):
    total, count = 0, 0
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise RuntimeError("output symlinks forbidden")
        if not path.is_file():
            continue
        count += 1
        size = path.stat().st_size
        total += size
        if path.suffix in (".log", ".stdout", ".stderr", ".jsonl") and size > 4 * 1024**2:
            raise RuntimeError("live process log exceeded 4 MiB")
        if count > 1024 or total > maximum:
            raise RuntimeError("live output budget exceeded")
    return total


@contextmanager
def cancellation_signals():
    def stop(signum, frame):
        raise KeyboardInterrupt(f"live campaign cancelled by signal {signum}")

    previous = signal.signal(signal.SIGTERM, stop)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


class ProcessScope:
    def __init__(self, *, directory, budget=output_budget):
        self.directory, self.budget = directory, budget
        self.processes, self.trees, self.history = [], [], []
        self.finished = set()
        self.cleanup = dict(completed=False, failures=[], roots=[])

    def spawn(self, *, command, environment, stdout, stderr=None, stdin=None):
        with stdout.open("xb") as out:
            err = stderr.open("xb") if stderr is not None else None
            incoming = stdin.open("rb") if stdin is not None else None
            try:
                process = subprocess.Popen(command, env=environment, stdin=incoming or subprocess.DEVNULL,
                    stdout=out, stderr=err or subprocess.STDOUT, start_new_session=True, close_fds=True)
            finally:
                if err is not None:
                    err.close()
                if incoming is not None:
                    incoming.close()
        self.processes.append(process)
        self.history.append(dict(pid=process.pid, command=list(command), started=time.monotonic()))
        try:
            self.trees.append(ProcessTree(process=process))
        except BaseException:
            process.kill()
            process.wait(timeout=10)
            raise
        return process

    def check(self, *, companions=()):
        for tree in self.trees:
            if tree.process.pid not in self.finished:
                tree.refresh()
        self.budget(directory=self.directory)
        if any(process.poll() is not None for process in companions):
            raise RuntimeError("persistent companion exited before native completion")

    def wait(self, *, process, timeout, companions=()):
        if not 0 < timeout <= 300:
            raise ValueError("process deadline must be within 300 seconds")
        start = time.monotonic()
        while process.poll() is None:
            self.check(companions=companions)
            if time.monotonic() - start > timeout:
                raise TimeoutError("live subprocess wall-clock deadline exceeded")
            time.sleep(0.05)
        if process.returncode != 0:
            raise RuntimeError(f"subprocess {process.pid} failed with code {process.returncode}")
        self.check(companions=companions)
        return dict(pid=process.pid, returncode=process.returncode, elapsed_seconds=time.monotonic() - start)

    def until(self, *, predicate, process, timeout):
        start = time.monotonic()
        while not predicate():
            self.check(companions=(process,))
            if time.monotonic() - start > timeout:
                raise TimeoutError("live worker readiness deadline exceeded")
            time.sleep(0.05)
        self.check(companions=(process,))

    def close(self):
        for tree in reversed(self.trees):
            if tree.process.pid in self.finished:
                continue
            try:
                self.finish(process=tree.process)
            except Exception as error:
                self.cleanup["failures"].append(f"pid {tree.process.pid}: {error}")
        self.cleanup["completed"] = not self.cleanup["failures"]
        return self.cleanup

    def finish(self, *, process):
        if process.pid in self.finished:
            return
        tree = next(tree for tree in self.trees if tree.process is process)
        tree.terminate()
        self.finished.add(process.pid)
        self.cleanup["roots"].append(dict(pid=process.pid, reaped=True))

    def __enter__(self):
        return self

    def __exit__(self, kind, error, traceback):
        self.close()
        if error is None and not self.cleanup["completed"]:
            raise RuntimeError("live process cleanup incomplete")
