"""Resolve ordered native parameter events against one frame's public controls.

Every frame supplies its own baseline. A reset clears this frame's controls;
callers wanting them to stay cleared must also supply an empty later baseline.
"""
from dataclasses import dataclass

import numpy as np

from body_composition.controls import validate_controls


@dataclass(frozen=True)
class ResolvedBodyControls:
    values: dict[str, float]
    targets: dict[str, np.float32]
    force_reapply: bool
    reset_clock: bool


def _validate_event(*, event):
    if not isinstance(event, dict):
        raise ValueError('body control events must be objects')
    kind = event.get('type')
    if kind == 'reset_params' and set(event) == {'type'}:
        return ('reset_params', None, None)
    if kind == 'set_control' and set(event) == {'type', 'name', 'value'}:
        name = event['name']
        if not isinstance(name, str):
            raise ValueError('body control event name must be a supported string')
        values, _ = validate_controls(controls={name: event['value']})
        return ('set_control', name, values[name])
    raise ValueError('body control event requires reset_params or set_control with name and value')


def resolve_control_events(*, controls, control_events=()):
    """Validate the entire frame before applying events to a private controls copy."""
    values, targets = validate_controls(controls=controls)
    if not isinstance(control_events, (list, tuple)):
        raise ValueError('body control events must be an ordered list or tuple')
    events = tuple(_validate_event(event=event) for event in control_events)
    reset_clock = False
    for kind, name, value in events:
        if kind == 'reset_params':
            values = {}
            reset_clock = True
        else:
            values[name] = value
    if events:
        values, targets = validate_controls(controls=values)
    # Assigning an unchanged value still dirties the native component; any reset
    # also clears its clock even if a later event restores the former values.
    return ResolvedBodyControls(values=values, targets=targets,
                                force_reapply=bool(events), reset_clock=reset_clock)
