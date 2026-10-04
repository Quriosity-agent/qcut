"""Track debugger descendants even when they create sessions or are reparented."""
from __future__ import annotations

from dataclasses import dataclass
import os
import signal
import subprocess
import time


@dataclass(frozen=True)
class ProcessIdentity:
    pid: int
    parent: int
    state: str
    started: str
    executable: str

    def matches(self, *, other):
        return (self.pid, self.started, self.executable) == (other.pid, other.started, other.executable)


def parse_snapshot(*, text):
    if len(text) > 8 * 1024**2:
        raise ValueError("process snapshot exceeds bound")
    result = {}
    for line in text.splitlines():
        fields = line.split(maxsplit=8)
        if len(fields) != 9 or not fields[0].isdigit() or not fields[1].isdigit():
            raise ValueError("invalid process identity row")
        pid, parent = int(fields[0]), int(fields[1])
        if pid < 1 or parent < 0 or pid in result:
            raise ValueError("invalid or duplicate process identity")
        result[pid] = ProcessIdentity(pid, parent, fields[2], " ".join(fields[3:8]), fields[8])
    return result


def snapshot():
    result = subprocess.run(["ps", "-axo", "pid=,ppid=,stat=,lstart=,comm="],
                            capture_output=True, text=True, check=True, timeout=3,
                            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    return parse_snapshot(text=result.stdout)


class ProcessTree:
    def __init__(self, *, process):
        self.process = process
        self.owned = {}
        try:
            self.refresh()
        except BaseException:
            self.process.kill()
            self.process.wait(timeout=10)
            raise

    def refresh(self):
        current = snapshot()
        root = current.get(self.process.pid)
        if root is not None:
            previous = self.owned.get(root.pid)
            same_root = (not self.owned or
                         previous is not None and previous.started == root.started)
            # Only the unreaped Popen child can retain ownership across exec.
            if same_root and self.process.poll() is None:
                self.owned[root.pid] = root
        parents = {pid for pid, identity in self.owned.items()
                   if pid in current and identity.matches(other=current[pid])}
        while parents:
            children = {pid for pid, identity in current.items()
                        if identity.parent in parents and pid not in self.owned}
            for pid in children:
                self.owned[pid] = current[pid]
            parents = children
        return current

    def wait(self, *, timeout):
        deadline = time.monotonic() + timeout
        while True:
            self.refresh()
            result = self.process.poll()
            if result is not None:
                return result
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(self.process.args, timeout)
            time.sleep(min(0.1, remaining))

    def ambiguous_descendants(self, *, current):
        return {pid for pid, identity in self.owned.items()
                if pid != self.process.pid and pid in current
                and identity.started == current[pid].started
                and identity.executable != current[pid].executable
                and not current[pid].state.startswith("Z")}

    def terminate(self):
        # A debugserver target can have a new PGID and outlive the LLDB parent.
        try:
            current = self.refresh()
        except BaseException:
            self.process.kill()
            self.process.wait(timeout=10)
            raise
        ambiguous = self.ambiguous_descendants(current=current)
        root = current.get(self.process.pid)
        identity = self.owned.get(self.process.pid)
        # A group signal could include a descendant whose exec invalidated ownership.
        if not ambiguous and root is not None and identity is not None and identity.matches(other=root):
            try:
                if self.process.poll() is None and os.getpgid(root.pid) == root.pid:
                    os.killpg(root.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.process.kill()
        try:
            for pid, identity in reversed(tuple(self.owned.items())):
                current = snapshot()
                ambiguous.update(self.ambiguous_descendants(current=current))
                observed = current.get(pid)
                if (pid in ambiguous or observed is None or observed.state.startswith("Z")
                        or not identity.matches(other=observed)):
                    continue
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        finally:
            self.process.wait(timeout=10)
        deadline = time.monotonic() + 3
        while True:
            current = snapshot()
            ambiguous.update(self.ambiguous_descendants(current=current))
            remaining = [pid for pid, identity in self.owned.items() if pid in current
                         and pid not in ambiguous and identity.matches(other=current[pid])
                         and not current[pid].state.startswith("Z")]
            if not remaining:
                if ambiguous:
                    raise RuntimeError(f"ambiguous descendant identities during cleanup: {sorted(ambiguous)}")
                return
            if time.monotonic() >= deadline:
                raise RuntimeError(f"owned processes survived cleanup: {remaining}")
            time.sleep(0.05)
