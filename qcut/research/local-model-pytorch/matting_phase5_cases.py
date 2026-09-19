"""Independent full-shape Phase5 inputs, separate from arithmetic calibration."""
import torch

from matting_torch import INPUT_SHAPES


def holdout_cases() -> dict[str, dict[str, torch.Tensor]]:
    cases = {}
    for seed in (7103, 19019, 65537):
        generator = torch.Generator().manual_seed(seed)
        cases[f"phase5-holdout-{seed}"] = {name: torch.rand(shape, generator=generator) * 2 - 1
                                          for name, shape in INPUT_SHAPES.items()}
    impulses = {name: torch.zeros(shape) for name, shape in INPUT_SHAPES.items()}
    for value in impulses.values():
        value[:, :, 0, 0] = 1
        value[:, :, -1, -1] = -.75
        value[:, :, value.shape[2] // 2, value.shape[3] // 2] = .125
    cases["phase5-asymmetric-impulses"] = impulses
    return cases
