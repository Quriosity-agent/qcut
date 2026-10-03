"""Owned ordinary smoothing with explicit native initialization dependencies.

Native parameters and initialization signals remain required. Initialization
can use an explicit owned 160-profile seed; the legacy native seed route is
separate and recorded. Published/current points are reference checks only.
"""
from __future__ import annotations

import numpy as np

from face_alignment_replay import point_difference
from face_host_geometry_contract import smoothing_states, validate_snapshot
import face_temporal_smoothing as math


def xy(*, values):
    return np.asarray(values, np.float32).reshape(-1, 2)


def parameters(*, states):
    smoothing_states(value=states)
    return tuple((state["alpha"], state["scale"], state["escale"],
                  state["width"], state["height"]) for state in states)


def initialize(*, points, states):
    result = []
    for state, part in zip(states, (points[:33], points[33:]), strict=True):
        item = math.initialize(points=part, alpha=state["alpha"], escale=state["escale"],
                               width=state["width"], height=state["height"])
        if item.scale != np.float32(state["scale"]):
            raise ValueError("native initialization scale differs from pinned formula")
        result.append(item)
    return math.BaseState(first33=result[0], last73=result[1])


def state_checks(*, owned, observed, initialized):
    checks = {}
    parts = (owned.first33, owned.last73)
    keys = (("current", "current_xy"),) if initialized else (("current", "current_xy"), ("previous", "previous_xy"))
    for name, key in keys:
        actual = np.concatenate([getattr(part, name) for part in parts])
        expected = np.concatenate([xy(values=state[key]) for state in observed])
        checks[name] = point_difference(actual=actual, expected=expected, tolerance=0)
    if not initialized:
        delta = np.concatenate([np.asarray(list(zip(state["delta_x"], state["delta_y"], strict=True)), np.float32)
                                for state in observed])
        checks["delta"] = point_difference(actual=np.concatenate([part.delta for part in parts]), expected=delta, tolerance=0)
    for actual, reference in zip(parts, observed, strict=True):
        if actual.first is not reference["first"]:
            raise ValueError("native first-update signal differs from owned state")
    return checks


class TemporalReplay:
    def __init__(self, *, owned_initialization=False):
        if type(owned_initialization) is not bool:
            raise ValueError("typed owned initialization policy required")
        self.owned_initialization = owned_initialization
        self.state = None
        self.identity = None
        self.profile = None
        self.index = -1
        self.seen_ids = set()

    def apply(self, *, snapshot, points, initialization_seed=None):
        validate_snapshot(row=snapshot)
        if snapshot["index"] != self.index + 1:
            raise ValueError("ordered contiguous temporal predictions required")
        routing = snapshot.get("runtime_state")
        if (not isinstance(routing, dict) or routing["base_output_mode_bit"] or
                routing["optimized_output_bit"] or routing["config_cache_mode"] > 0):
            raise ValueError("observed uncached ordinary Base profile required")
        active = [face for face in snapshot["faces"] if face["active"]]
        if len(active) > 1:
            raise ValueError("multi-face temporal association remains unresolved")
        if not active:
            if points is not None or initialization_seed is not None:
                raise ValueError("no-face prediction must not carry candidate points")
            self.state, self.identity, self.profile, self.index = None, None, None, snapshot["index"]
            return None, dict(passed=True, mode="no-face", checks={}, native_seed_used=False, owned_seed_used=False)
        face = active[0]
        if not isinstance(points, np.ndarray) or points.dtype != np.float32 or points.shape != (106, 2):
            raise ValueError("owned float32 106-point prediction required")
        states = face.get("smoothing")
        profile = parameters(states=states)
        initialized = all(state["first"] for state in states)
        if initialized != any(state["first"] for state in states):
            raise ValueError("partial Base initialization is unsupported")
        identity = (face["slot"], face["alignment"], face["id"])
        new = identity != self.identity
        if new and face["id"] in self.seen_ids:
            raise ValueError("reactivated or reassigned face ID is unresolved")
        if self.state is not None and (new or profile != self.profile):
            raise ValueError("unobserved live identity/parameter transition rejected")
        needs_seed = new and not initialized
        if initialization_seed is not None and (not needs_seed or not self.owned_initialization):
            raise ValueError("unexpected or undeclared owned initialization seed")
        if needs_seed and self.owned_initialization and initialization_seed is None:
            raise ValueError("owned initialization seed required; native fallback forbidden")
        native_seed = needs_seed and not self.owned_initialization
        owned_seed = needs_seed and self.owned_initialization
        if initialized:
            state = initialize(points=points, states=states)
            result, mode = points.copy(), "owned-input-initialization"
        else:
            state = self.state
            if state is None:
                seed = initialization_seed
                if native_seed:
                    if any(len(item["previous_xy"]) != item["count"] * 2 for item in states):
                        raise ValueError("explicit native pre-update initialization seed required")
                    seed = np.concatenate([xy(values=item["previous_xy"]) for item in states])
                if (not isinstance(seed, np.ndarray) or seed.dtype != np.float32 or seed.shape != (106, 2)):
                    raise ValueError("owned float32 106-point initialization seed required")
                state = initialize(points=seed, states=states)
            result, state = math.update_base(state=state, points=points, optimized=False)
            mode = "native-initialization-seed" if native_seed else (
                "owned-initialization-seed" if owned_seed else "owned-history-update")
        checks = state_checks(owned=state, observed=states, initialized=initialized)
        passed = all(check["exact"] for check in checks.values())
        if not passed:
            raise RuntimeError("owned temporal state differs; no reference correction")
        self.state, self.identity, self.profile, self.index = state, identity, profile, snapshot["index"]
        self.seen_ids.add(face["id"])
        return result, dict(passed=passed, mode=mode, native_seed_used=native_seed, owned_seed_used=owned_seed,
                            native_initialization_signal_required=True, checks=checks)
