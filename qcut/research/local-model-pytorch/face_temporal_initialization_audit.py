"""Report provenance for owned temporal state and 160 initialization seeds."""
from __future__ import annotations

from face_temporal_audit_metrics import count, flag, metric, require
from face_host_initialization import select_initialization

SMOOTHING_STAGE, INITIALIZATION_STAGE = "owned_smoothing", "owned_initialization"


def initialization_case(*, snapshot, case, association, required):
    proof = case.get("owned_initialization")
    if not required:
        require(condition="owned_initialization" not in case, message="unexpected owned initialization evidence")
        return None
    require(condition=isinstance(proof, dict) and flag(row=proof, key="passed")
            and proof.get("source") == "onnx-160-detection-backmap"
            and not flag(row=proof, key="native_point_seed_used")
            and flag(row=proof, key="native_detection_geometry_required"), message="owned initialization seed provenance differs")
    face = next(face for face in snapshot["faces"] if face["active"])
    for key, expected in (("prediction", snapshot["index"]), ("id", face["id"]), ("slot", face["slot"])):
        count(row=proof, key=key, expected=expected)
    inference, selection = select_initialization(snapshot=snapshot, association=association)
    count(row=proof, key="inference", expected=inference["inference"])
    require(condition=proof.get("network") == inference["network"], message="owned initialization network differs")
    if selection["excluded_160_inferences"] or "association_mode" in proof:
        require(condition=proof.get("association_mode") == selection["association_mode"],
                message="explicit initialization ordering evidence required")
        for key in ("seed_record_index", "tracking_record_index", "tracking_inference"):
            count(row=proof, key=key, expected=selection[key])
        excluded = proof.get("excluded_160_inferences")
        require(condition=isinstance(excluded, list) and all(type(item) is int for item in excluded)
                and excluded == selection["excluded_160_inferences"], message="excluded initialization candidates differ")
    exact, error = metric(value=proof.get("check"))
    require(condition=exact, message="owned initialization is not exact")
    return dict(index=snapshot["index"], exact=exact, max_abs=error, participating=True)


def smoothing_case(*, snapshot, case, prior_identity, stages, association, owned_initialization):
    value = case.get("temporal_smoothing")
    require(condition=isinstance(value, dict) and flag(row=value, key="passed"), message="passed owned smoothing evidence required")
    seed = flag(row=value, key="native_seed_used")
    owned_seed = flag(row=value, key="owned_seed_used") if "owned_seed_used" in value else False
    require(condition=not owned_initialization or "owned_seed_used" in value, message="typed owned seed declaration required")
    active = [face for face in snapshot["faces"] if face["active"]]
    checks = value.get("checks")
    require(condition=isinstance(checks, dict), message="owned smoothing state metrics required")
    if not active:
        require(condition=value.get("mode") == "no-face" and not seed and not owned_seed and not checks,
                message="no-face smoothing must clear history")
        initialization_case(snapshot=snapshot, case=case, association=association, required=False)
        return None, False, False
    face = active[0]
    identity = (face["slot"], face["alignment"], face["id"])
    states = face.get("smoothing")
    require(condition=isinstance(states, list) and len(states) == 2, message="captured smoothing partitions required")
    initialized = all(state["first"] for state in states)
    require(condition=initialized == any(state["first"] for state in states), message="partial smoothing initialization rejected")
    seed_mode = "owned-initialization-seed" if owned_initialization else "native-initialization-seed"
    mode = "owned-input-initialization" if initialized else (
        "owned-history-update" if identity == prior_identity else seed_mode)
    require(condition=value.get("mode") == mode and seed == (mode == "native-initialization-seed")
            and owned_seed == (mode == "owned-initialization-seed")
            and flag(row=value, key="native_initialization_signal_required"), message="owned smoothing transition/seed provenance differs")
    routing = snapshot.get("runtime_state", {})
    require(condition=routing.get("base_output_mode_bit") is False and routing.get("optimized_output_bit") is False
            and type(routing.get("config_cache_mode")) is int and routing["config_cache_mode"] <= 0,
            message="owned smoothing route differs")
    require(condition=set(checks) == ({"current"} if initialized else {"current", "previous", "delta"}),
            message="missing owned smoothing state checks")
    results = [metric(value=check) for check in checks.values()]
    exact = all(row[0] for row in results)
    require(condition=value["passed"] == exact, message="owned smoothing aggregate differs")
    stages[SMOOTHING_STAGE].append(dict(index=snapshot["index"], exact=exact,
                                      max_abs=max(row[1] for row in results), participating=True))
    proof = initialization_case(snapshot=snapshot, case=case, association=association, required=owned_seed)
    if proof is not None:
        stages[INITIALIZATION_STAGE].append(proof)
    return identity, seed, owned_seed


def seed_summary(*, replay, key, expected, maximum):
    declared = replay.get(key)
    require(condition=isinstance(declared, list) and len(declared) <= maximum
            and all(type(index) is int for index in declared) and declared == expected,
            message="owned smoothing seed/publication summary differs")
