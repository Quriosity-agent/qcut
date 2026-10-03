"""Bounded local socket framing for fresh dependency pixels, never file lookup."""
from __future__ import annotations

import json
import socket
import struct
import time

from face_alignment_replay import strict_json

HEADER = struct.Struct("!II")
JSON_LIMIT = 128 * 1024
PIXEL_LIMIT = 16 * 1024**2


def receive_exact(*, connection, count, deadline):
    parts = []
    while count:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("live worker frame deadline exceeded")
        connection.settimeout(remaining)
        part = connection.recv(count)
        if not part:
            raise EOFError("truncated live worker frame")
        parts.append(part)
        count -= len(part)
    return b"".join(parts)


def receive(*, connection, timeout):
    deadline = time.monotonic() + timeout
    size, pixel_size = HEADER.unpack(receive_exact(connection=connection, count=HEADER.size, deadline=deadline))
    if not 1 <= size <= JSON_LIMIT or not 0 <= pixel_size <= PIXEL_LIMIT:
        raise ValueError("live frame exceeds JSON/pixel budgets")
    message = strict_json(data=receive_exact(connection=connection, count=size, deadline=deadline))
    if type(message) is not dict:
        raise ValueError("live frame object required")
    pixels = receive_exact(connection=connection, count=pixel_size, deadline=deadline)
    return message, pixels


def send(*, connection, message, pixels=b"", timeout=15):
    payload = json.dumps(message, separators=(",", ":"), allow_nan=False).encode()
    if not 1 <= len(payload) <= JSON_LIMIT or len(pixels) > PIXEL_LIMIT:
        raise ValueError("live frame exceeds JSON/pixel budgets")
    connection.settimeout(timeout)
    connection.sendall(HEADER.pack(len(payload), len(pixels)) + payload + pixels)


def exchange(*, path, message, pixels=b"", timeout=15):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(str(path))
        send(connection=connection, message=message, pixels=pixels, timeout=timeout)
        reply, raw = receive(connection=connection, timeout=timeout)
        if raw or reply.get("ok") is not True:
            raise RuntimeError(reply.get("error", "live worker rejected request"))
        return reply
