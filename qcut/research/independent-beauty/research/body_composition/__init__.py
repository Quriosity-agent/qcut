"""Owned ten-part body composition, orientation zero and no protection masks."""

from .controls import BODY_ORDER as ORDER

__all__ = ["CombinedBody", "PersistentCombinedBody", "ORDER"]


def __getattr__(name):
    # Slider validation stays importable without the macOS libm geometry ABI.
    if name == "CombinedBody":
        from .pipeline import CombinedBody

        return CombinedBody
    if name == "PersistentCombinedBody":
        from .persistent import PersistentCombinedBody

        return PersistentCombinedBody
    raise AttributeError(name)
