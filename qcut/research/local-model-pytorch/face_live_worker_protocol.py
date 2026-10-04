"""Bounded local socket framing for fresh dependency pixels, never file lookup."""
from __future__ import annotations

import json
import math
import socket
import struct
import time

HEADER = struct.Struct("!II")
JSON_LIMIT = 128 * 1024
PIXEL_LIMIT = 16 * 1024**2


def decode_message(*, data):
    def unique_fields(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate live JSON field")
            result[key] = value
        return result

    def finite_number(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("non-finite live JSON number")
        return number

    # LLDB uses its own Python without the model environment's NumPy.
    message = json.loads(data.decode("utf-8"), object_pairs_hook=unique_fields,
                         parse_float=finite_number, parse_constant=finite_number)
    if type(message) is not dict:
        raise ValueError("live frame object required")
    return message


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
    message = decode_message(data=receive_exact(connection=connection, count=size, deadline=deadline))
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
