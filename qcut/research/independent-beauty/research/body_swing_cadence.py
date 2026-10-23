"""Two graph updates and post-first-update controls of the pinned Swing host."""

from dataclasses import dataclass
import math

from body_control_events import ResolvedBodyControls, resolve_control_events


@dataclass(frozen=True)
class SwingUpdate:
    controls: ResolvedBodyControls
    timestamp: float
    reapply: bool


def swing_timestamp(*, timestamp):
    if (isinstance(timestamp, bool) or not isinstance(timestamp, (int, float))
            or not math.isfinite(timestamp) or timestamp < 0):
        raise ValueError('finite nonnegative Swing timestamp required')
    scaled = timestamp * 1_000_000
    if scaled >= 2 ** 63 - 1024:
        raise ValueError('Swing timestamp exceeds signed microsecond range')
    # The host uses std::llround, whose positive half ties round away from zero.
    return math.floor(scaled + .5) / 1_000_000


def swing_updates(*, previous_controls, controls, timestamp,
                  control_events=(), reapply_controls=False):
    if type(reapply_controls) is not bool:
        raise ValueError('reapply_controls must be a boolean')
    previous = resolve_control_events(controls=previous_controls)
    current = resolve_control_events(controls=controls, control_events=control_events)
    timestamp = swing_timestamp(timestamp=timestamp)
    return (SwingUpdate(controls=previous, timestamp=timestamp, reapply=False),
            SwingUpdate(controls=current, timestamp=timestamp,
                        reapply=reapply_controls or current.force_reapply))
