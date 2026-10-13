"""Bounded, opt-in reuse of stateless CPU ONNX sessions in the serial worker."""
from collections import OrderedDict
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib


ACTIVE_CACHE = ContextVar('independent_session_cache', default=None)
MAX_MODEL_BYTES = 64 * 1024 * 1024


class SessionCache:
    def __init__(self, *, max_entries=16, max_bytes=256 * 1024 * 1024):
        if (type(max_entries) is not int or not 1 <= max_entries <= 32
                or type(max_bytes) is not int or not 1 <= max_bytes <= 512 * 1024 * 1024):
            raise ValueError('bounded session cache limits required')
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.entries = OrderedDict()
        self.bytes = 0
        self.hits = 0
        self.misses = 0

    def acquire(self, *, data, optimize, create):
        key = (hashlib.sha256(data).hexdigest(), optimize)
        if key in self.entries:
            self.hits += 1
            self.entries.move_to_end(key)
            return self.entries[key][0]
        self.misses += 1
        session = create(data=data, optimize=optimize)
        if len(data) <= self.max_bytes:
            while self.entries and (len(self.entries) >= self.max_entries or self.bytes + len(data) > self.max_bytes):
                _, (_, size) = self.entries.popitem(last=False)
                self.bytes -= size
            self.entries[key] = (session, len(data))
            self.bytes += len(data)
        return session

    def snapshot(self):
        return {'entries': len(self.entries), 'modelBytes': self.bytes,
                'hits': self.hits, 'misses': self.misses,
                'maxEntries': self.max_entries, 'maxModelBytes': self.max_bytes}


@contextmanager
def reuse_sessions(*, cache):
    token = ACTIVE_CACHE.set(cache)
    try:
        yield cache
    finally:
        ACTIVE_CACHE.reset(token)


def _create(*, data, optimize):
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    if not optimize:
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    return ort.InferenceSession(data, sess_options=options, providers=['CPUExecutionProvider'])


def cpu_session(*, data, optimize=False):
    if type(data) is not bytes or not 0 < len(data) <= MAX_MODEL_BYTES or type(optimize) is not bool:
        raise ValueError('bounded model bytes and explicit CPU optimization mode required')
    cache = ACTIVE_CACHE.get()
    if cache is None:
        return _create(data=data, optimize=optimize)
    return cache.acquire(data=data, optimize=optimize, create=_create)
