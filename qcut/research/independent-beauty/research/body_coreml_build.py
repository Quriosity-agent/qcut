"""Build/cache the owned resident host against Apple's system frameworks only."""
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import time

from body_coreml_assets import digest

HOST_SOURCE = Path(__file__).with_name('body_coreml_host.mm')


class CoreMLBuildIntegrityError(RuntimeError):
    pass


def system_environment():
    return {key: value for key, value in os.environ.items()
            if not key.startswith(('DYLD_', 'LD_'))}


def terminate_process(*, process):
    if process is None:
        return
    try:
        process.terminate()
        process.wait(timeout=0.5)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=0.5)


def _check_cancelled(*, cancelled):
    if cancelled():
        raise RuntimeError('CoreML host preparation cancelled')


def _cached_host(*, binary, receipt, source_hash):
    try:
        identity = json.loads(receipt.read_text())
        if not isinstance(identity, dict):
            return None
        if (identity.get('sourceSha256') == source_hash and binary.is_file()
                and os.access(binary, os.X_OK) and identity.get('binarySha256') == digest(path=binary)):
            return identity
    except (OSError, ValueError):
        pass
    return None


def prepare_host(*, cache_directory, cancelled, register_process):
    if platform.system() != 'Darwin':
        raise RuntimeError('system CoreML body inference requires macOS')
    import fcntl
    source_hash = digest(path=HOST_SOURCE)
    root = Path(cache_directory).resolve() / ('body-coreml-' + source_hash[:20] + '-' + platform.machine())
    root.mkdir(parents=True, exist_ok=True)
    binary, receipt = root / 'body-coreml-host', root / 'build.json'
    with (root / 'build.lock').open('a') as lock:
        while True:
            _check_cancelled(cancelled=cancelled)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(0.025)
        cached = _cached_host(binary=binary, receipt=receipt, source_hash=source_hash)
        if cached:
            return {**cached, 'binary': str(binary)}
        with tempfile.TemporaryDirectory(prefix='build-', dir=root) as temporary:
            output = Path(temporary) / 'body-coreml-host'
            command = ['/usr/bin/xcrun', 'clang++', '-std=c++17', '-fobjc-arc', '-O2',
                       '-framework', 'Foundation', '-framework', 'CoreML', str(HOST_SOURCE), '-o', str(output)]
            _check_cancelled(cancelled=cancelled)
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       env=system_environment())
            register_process(process)
            try:
                while True:
                    _check_cancelled(cancelled=cancelled)
                    try:
                        compiler_output = process.communicate(timeout=0.1)[0]
                        break
                    except subprocess.TimeoutExpired:
                        continue
                _check_cancelled(cancelled=cancelled)
                if process.returncode:
                    raise RuntimeError('CoreML host compilation failed: ' + compiler_output[-8192:].decode(errors='replace'))
                if digest(path=HOST_SOURCE) != source_hash:
                    raise CoreMLBuildIntegrityError('CoreML host source changed during compilation')
                identity = {'sourceSha256': source_hash, 'binarySha256': digest(path=output)}
                output.replace(binary)
                pending_receipt = Path(temporary) / 'build.json'
                pending_receipt.write_text(json.dumps(identity, sort_keys=True))
                pending_receipt.replace(receipt)
                return {**identity, 'binary': str(binary)}
            finally:
                terminate_process(process=process)
                if process.stdout:
                    process.stdout.close()
                register_process(None)
