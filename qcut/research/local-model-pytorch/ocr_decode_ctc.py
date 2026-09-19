"""Strict NumPy greedy CTC with explicit layout, blank and Unicode semantics."""
from dataclasses import dataclass
import math
import unicodedata

import numpy as np


@dataclass(frozen=True)
class Alphabet:
    tokens: tuple[str | None, ...]
    blank_id: int

    def __post_init__(self):
        if (not isinstance(self.tokens, tuple) or not 2 <= len(self.tokens) <= 16384
                or type(self.blank_id) is not int or not 0 <= self.blank_id < len(self.tokens)):
            raise ValueError("invalid class table or blank index")
        for index, value in enumerate(self.tokens):
            if index == self.blank_id:
                if value is not None:
                    raise ValueError("blank must be null, not a printable token")
                continue
            if not isinstance(value, str) or not 1 <= len(value) <= 16:
                raise ValueError("nonblank token must be nonempty Unicode")
            if any(unicodedata.category(char) in ("Cc", "Cs") for char in value):
                raise ValueError("control characters and surrogates are not tokens")


def time_major(*, logits, layout, classes):
    if (not isinstance(logits, np.ndarray) or logits.dtype != np.float32
            or logits.size > 16 * 1024**2 or not np.isfinite(logits).all()):
        raise ValueError("bounded finite float32 logits required")
    if layout == "TC" and logits.ndim == 2:
        values = logits[None]
    elif layout == "NTC" and logits.ndim == 3:
        values = logits
    elif layout == "NCT" and logits.ndim == 3:
        values = logits.transpose(0, 2, 1)
    elif layout == "NCHW" and logits.ndim == 4 and logits.shape[2] == 1:
        values = logits[:, :, 0, :].transpose(0, 2, 1)
    else:
        raise ValueError("explicit supported logits layout required")
    batch, steps, count = values.shape
    if not 1 <= batch <= 32 or not 1 <= steps <= 4096 or count != classes:
        raise ValueError("invalid logits batch, time or class dimensions")
    return values


def collapse_ids(*, ids, alphabet):
    if not isinstance(alphabet, Alphabet) or not isinstance(ids, (tuple, list)) or len(ids) > 4096:
        raise ValueError("bounded ID sequence and validated alphabet required")
    emitted, previous = [], None
    for step, value in enumerate(ids):
        if type(value) is not int or not 0 <= value < len(alphabet.tokens):
            raise ValueError("class ID outside alphabet")
        if value != alphabet.blank_id:
            if value != previous:
                emitted.append({"id": value, "text": alphabet.tokens[value], "start": step, "end": step + 1})
            else:
                emitted[-1]["end"] = step + 1
        # A blank breaks repetition: A, blank, A decodes to AA.
        previous = value
    return emitted


def decode_logits(*, logits, alphabet, layout, lengths=None):
    if not isinstance(alphabet, Alphabet):
        raise ValueError("validated alphabet required")
    values = time_major(logits=logits, layout=layout, classes=len(alphabet.tokens))
    batch, steps, _ = values.shape
    if lengths is None:
        lengths = [steps] * batch
    if (not isinstance(lengths, (list, tuple)) or len(lengths) != batch
            or any(type(length) is not int or not 0 <= length <= steps for length in lengths)):
        raise ValueError("one bounded integer length per batch entry required")
    results = []
    for row, length in zip(values, lengths, strict=True):
        active = row[:length]
        ids = active.argmax(axis=1).tolist()
        emitted = collapse_ids(ids=ids, alphabet=alphabet)
        scores = []
        for token in emitted:
            logits_at_start = active[token["start"]].astype(np.float64)
            shifted = logits_at_start - logits_at_start[token["id"]]
            log_probability = -float(np.log(np.exp(shifted).sum()))
            scores.append(log_probability)
            token["start_probability"] = math.exp(log_probability)
        results.append({"text": "".join(item["text"] for item in emitted), "ids": ids,
                        "tokens": emitted, "valid_steps": length,
                        "emission_geometric_mean": math.exp(sum(scores) / len(scores)) if scores else None,
                        "score_semantics": "diagnostic first-step softmax; not calibrated OCR confidence",
                        "normalization": "none", "time_direction": "forward"})
    return results
