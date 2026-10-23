"""Opt-in asynchronous system CoreML networks with one resident host per detector.

Readiness reports worker completion. The caller latches it before each detector's
crop/preprocessing and owns any route journal; this adapter never selects CPU.
"""
import base64
import copy
import json
import math
from pathlib import Path
import platform
import subprocess
import threading
import time
import uuid

import numpy as np

from body_coreml_assets import digest, model_identity, model_spec, verify_model
from body_coreml_build import CoreMLBuildIntegrityError, HOST_SOURCE, prepare_host, system_environment, terminate_process

MAX_MESSAGE_BYTES = 2 * 1024 * 1024


class BodyCoreMLError(RuntimeError):
    def __init__(self, message, *, error_kind=None):
        super().__init__(message)
        self.error_kind = error_kind


class BodyCoreMLIntegrityError(BodyCoreMLError):
    def __init__(self, message):
        super().__init__(message, error_kind='integrity')


class BodyCoreMLCancelled(BodyCoreMLError):
    pass


def _duration(*, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError('a finite positive timeout is required')
    return float(value)


def _launch(*, binary, model_directory, network):
    return subprocess.Popen([binary, str(model_directory), network], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=system_environment())


class BodyCoreMLNetwork:
    def __init__(self, *, network, model_directory, cache_directory,
                 startup_timeout=60, inference_timeout=30):
        spec = model_spec(network=network)
        self.network = network
        self.model_directory = Path(model_directory).resolve()
        self.cache_directory = Path(cache_directory).resolve()
        self.startup_timeout = _duration(value=startup_timeout)
        self.inference_timeout = _duration(value=inference_timeout)
        self.generation = str(uuid.uuid4())
        self._metadata = {'inputName': spec['input'], 'inputShapes': [[1, h, w, 3] for h, w in spec['sizes']],
                          'outputChannels': dict(spec['outputs']), 'outputStride': 8,
                          'inputEncoding': 'float32-nhwc', 'outputEncoding': 'float32-nhwc-physical-values'}
        source_files = [Path(__file__), Path(__file__).with_name('body_coreml_assets.py'),
                        Path(__file__).with_name('body_coreml_build.py'), HOST_SOURCE]
        self._identity = {**model_identity(network=network), 'adapter': 'system-coreml-resident-v1',
                          'sources': {path.name: digest(path=path) for path in source_files},
                          'system': platform.system(), 'systemRelease': platform.release(),
                          'machine': platform.machine(), 'macOS': platform.mac_ver()[0]}
        try:
            self._verified_model = verify_model(directory=self.model_directory, network=self.network)
        except (OSError, ValueError) as error:
            raise BodyCoreMLIntegrityError(str(error)) from error
        self._condition = threading.Condition()
        self._state, self._error, self._error_kind = 'new', None, None
        self._process = None
        self._worker = None
        self._startup_timer = None
        self._cancelled = False
        self._provenance = copy.deepcopy(self._verified_model)
        self._pending = None
        self._next_request = 1
        self._stderr = bytearray()

    @property
    def identity(self):
        return copy.deepcopy(self._identity)

    @property
    def metadata(self):
        return copy.deepcopy(self._metadata)

    @property
    def provenance(self):
        with self._condition:
            return copy.deepcopy(self._provenance)

    @property
    def status(self):
        with self._condition:
            return {'state': self._state, 'ready': self._state == 'ready', 'error': self._error,
                    'errorKind': self._error_kind, 'generation': self.generation, 'identity': self.identity}

    def _stopped(self):
        with self._condition:
            return self._state in ('failed', 'closed')

    def _register_process(self, process):
        with self._condition:
            stopped = self._state in ('failed', 'closed')
            if not stopped:
                self._process = process
        if stopped:
            terminate_process(process=process)

    def _fail(self, *, error, starting_only=False):
        with self._condition:
            if self._state in ('failed', 'closed') or (starting_only and self._state != 'starting'):
                return
            inferred_kind = 'initialization' if self._state == 'starting' else 'runtime'
            self._error_kind = ('integrity' if isinstance(error, CoreMLBuildIntegrityError)
                                else getattr(error, 'error_kind', None) or inferred_kind)
            self._state, self._error = 'failed', str(error)
            process = self._process
            self._condition.notify_all()
        terminate_process(process=process)

    def start(self):
        with self._condition:
            if self._state == 'new':
                self._state = 'starting'
                self._startup_timer = threading.Timer(self.startup_timeout, self._fail,
                    kwargs={'error': 'CoreML initialization timed out', 'starting_only': True})
                self._startup_timer.daemon = True
                self._worker = threading.Thread(target=self._run, name='body-coreml-' + self.network, daemon=True)
                self._startup_timer.start()
                self._worker.start()
            return self.status

    def _drain_stderr(self, *, process):
        try:
            while chunk := process.stderr.read(4096):
                with self._condition:
                    self._stderr.extend(chunk)
                    self._stderr[:] = self._stderr[-8192:]
        except (OSError, ValueError):
            return

    def _run(self):
        process, stderr_reader = None, None
        try:
            try:
                for name, expected in self._identity['sources'].items():
                    if digest(path=Path(__file__).with_name(name)) != expected:
                        raise ValueError('CoreML adapter source changed after construction')
                verified = verify_model(directory=self.model_directory, network=self.network)
            except (OSError, ValueError) as error:
                raise BodyCoreMLIntegrityError(str(error)) from error
            host = prepare_host(cache_directory=self.cache_directory, cancelled=self._stopped,
                                register_process=self._register_process)
            if host['sourceSha256'] != self._identity['sources'][HOST_SOURCE.name]:
                raise BodyCoreMLIntegrityError('CoreML host build source identity mismatch')
            if self._stopped():
                return
            process = _launch(binary=host['binary'], model_directory=self.model_directory, network=self.network)
            self._register_process(process)
            if self._stopped():
                return
            stderr_reader = threading.Thread(target=self._drain_stderr, kwargs={'process': process}, daemon=True)
            stderr_reader.start()
            with self._condition:
                self._provenance = {**verified, 'host': host, 'processId': process.pid,
                                    'privateNativeRuntimeLoaded': False}
            while not self._stopped():
                line = process.stdout.readline(MAX_MESSAGE_BYTES + 1)
                if not line:
                    raise BodyCoreMLError('CoreML host exited before close')
                if len(line) > MAX_MESSAGE_BYTES or not line.endswith(b'\n'):
                    raise BodyCoreMLIntegrityError('CoreML host response exceeds size limit or is truncated')
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeError) as error:
                    raise BodyCoreMLIntegrityError('CoreML host returned invalid JSON') from error
                self._receive(message=message, binary=host['binary'])
        except Exception as error:
            self._fail(error=error)
        finally:
            if self._startup_timer:
                self._startup_timer.cancel()
            terminate_process(process=process)
            if stderr_reader:
                stderr_reader.join(timeout=1)
            if process:
                for stream in (process.stdin, process.stdout, process.stderr):
                    if stream:
                        stream.close()

    def _receive(self, *, message, binary):
        if not isinstance(message, dict):
            raise BodyCoreMLIntegrityError('CoreML host response must be an object')
        with self._condition:
            if self._state in ('closed', 'failed'):
                return
            if message.get('type') == 'fatal':
                kind = message.get('errorKind')
                if kind not in ('integrity', 'initialization', 'runtime') or (self._state == 'ready' and kind == 'initialization'):
                    raise BodyCoreMLIntegrityError('CoreML host failure classification missing or invalid')
                raise BodyCoreMLError(str(message.get('error', 'CoreML prediction failed')), error_kind=kind)
            if self._state == 'starting':
                self._receive_ready(message=message, binary=binary)
                return
            pending = self._pending
            if (message.get('type') != 'result' or not pending or pending['result'] is not None
                    or type(message.get('id')) is not int or message['id'] != pending['id']):
                raise BodyCoreMLIntegrityError('CoreML host returned an unexpected request result')
            if message.get('systemLibrariesOnly') is not True:
                raise BodyCoreMLIntegrityError('CoreML host library verification missing')
            pending['result'] = self._decode_outputs(message=message, shape=pending['shape'])
            self._condition.notify_all()

    def _receive_ready(self, *, message, binary):
        if (message.get('type') != 'ready' or type(message.get('protocol')) is not int
                or message['protocol'] != 1 or message.get('network') != self.network
                or message.get('inputName') != self._metadata['inputName'] or message.get('computeUnits') != 'All'):
            raise BodyCoreMLIntegrityError('CoreML host readiness identity mismatch')
        images = message.get('loadedImages')
        if not isinstance(images, list) or not images or any(not isinstance(path, str) for path in images):
            raise BodyCoreMLIntegrityError('CoreML host loaded images missing')
        if Path(images[0]).resolve() != Path(binary).resolve():
            raise BodyCoreMLIntegrityError('CoreML host executable identity mismatch')
        if any(not path.startswith(('/System/', '/usr/lib/')) for path in images[1:]):
            raise BodyCoreMLIntegrityError('CoreML host loaded a non-system library')
        self._provenance['loadedImages'] = list(images)
        self._state = 'ready'
        self._startup_timer.cancel()
        self._condition.notify_all()

    def _decode_outputs(self, *, message, shape):
        outputs = message.get('outputs')
        channels = self._metadata['outputChannels']
        if not isinstance(outputs, dict) or set(outputs) != set(channels):
            raise BodyCoreMLError('CoreML host output names mismatch')
        decoded = {}
        for name, count in channels.items():
            expected = [1, shape[1] // 8, shape[2] // 8, count]
            item = outputs[name]
            if (not isinstance(item, dict) or item.get('shape') != expected
                    or any(type(value) is not int for value in item['shape']) or not isinstance(item.get('data'), str)):
                raise BodyCoreMLError('CoreML host output shape mismatch')
            raw = base64.b64decode(item['data'], validate=True)
            if len(raw) != math.prod(expected) * 4:
                raise BodyCoreMLError('CoreML host output length mismatch')
            array = np.frombuffer(raw, dtype='<f4').reshape(expected).copy()
            if not np.isfinite(array).all():
                raise BodyCoreMLError('CoreML host returned non-finite output')
            decoded[name] = array
        return decoded

    def _raise_unavailable(self):
        if self._cancelled:
            raise BodyCoreMLCancelled(self._error or 'CoreML network cancelled')
        raise BodyCoreMLError(self._error or 'CoreML network is ' + self._state, error_kind=self._error_kind)

    def wait_ready(self, *, timeout, cancelled=None):
        deadline = time.monotonic() + _duration(value=timeout)
        while True:
            if cancelled and cancelled():
                self.cancel()
            with self._condition:
                if self._state == 'ready':
                    return self.status
                if self._state != 'starting':
                    self._raise_unavailable()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('CoreML readiness wait timed out')
                self._condition.wait(min(remaining, 0.05))

    def _write(self, *, process, payload):
        try:
            process.stdin.write(payload)
            process.stdin.flush()
        except (OSError, ValueError) as error:
            self._fail(error=error)

    def infer(self, *, tensor, timeout=None, cancelled=None):
        duration = self.inference_timeout if timeout is None else _duration(value=timeout)
        array = np.asarray(tensor)
        if (array.dtype != np.float32 or list(array.shape) not in self._metadata['inputShapes']
                or not np.isfinite(array).all()):
            raise ValueError('finite float32 NHWC input with a supported body model shape required')
        encoded = base64.b64encode(array.astype('<f4', copy=False).tobytes(order='C')).decode('ascii')
        if cancelled and cancelled():
            self.cancel()
        with self._condition:
            if self._state != 'ready':
                self._raise_unavailable()
            if self._pending is not None:
                raise BodyCoreMLError('CoreML network already has an inference in flight')
            identifier = self._next_request
            self._next_request += 1
            pending = {'id': identifier, 'shape': list(array.shape), 'result': None}
            self._pending = pending
            process = self._process
            payload = (json.dumps({'type': 'predict', 'id': identifier, 'shape': pending['shape'],
                                   'data': encoded}, separators=(',', ':')) + '\n').encode()
            writer = threading.Thread(target=self._write, kwargs={'process': process, 'payload': payload}, daemon=True)
            writer.start()
        deadline = time.monotonic() + duration
        try:
            while True:
                if cancelled and cancelled():
                    self.cancel()
                with self._condition:
                    if self._state != 'ready':
                        self._raise_unavailable()
                    if pending['result'] is not None:
                        return pending['result']
                    remaining = deadline - time.monotonic()
                    if remaining > 0:
                        self._condition.wait(min(remaining, 0.05))
                        continue
                self._fail(error='CoreML prediction timed out')
                raise TimeoutError('CoreML prediction timed out')
        except BaseException as error:
            self._fail(error=error)
            raise
        finally:
            with self._condition:
                self._pending = None
            writer.join(timeout=1)

    def close(self):
        with self._condition:
            self._state = 'closed'
            process, worker = self._process, self._worker
            if self._startup_timer:
                self._startup_timer.cancel()
            self._condition.notify_all()
        terminate_process(process=process)
        if worker and worker is not threading.current_thread():
            worker.join(timeout=1)

    def cancel(self):
        with self._condition:
            self._cancelled = True
            self._error = 'CoreML network cancelled'
            self._error_kind = None
        self.close()

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *_):
        self.close()
