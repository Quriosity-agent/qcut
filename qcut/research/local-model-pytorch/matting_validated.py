"""Approved research-only GRU v3 artifact; older arithmetic profiles stay disabled."""
from matting_torch import load_model as load_candidate

ARTIFACT_SHA256 = "8ebbc40d75faa48ff584f80401d2ac910d9377915bcfed2f506a308b062ba239"


def load_model(*, path):
    # The digest pins the entire evaluated graph/state/profile, not a self-reported status.
    return load_candidate(path=path, expected_sha256=ARTIFACT_SHA256, allow_unverified=True)
