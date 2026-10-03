"""Pure synthetic FsNew geometry contract regressions; no native calls or assets."""

from copy import deepcopy
import unittest

import face_host_geometry_contract as contract


def geometry_row(*, index=0):
    affine = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    face = dict(slot=0, alignment=65536, active=True, id=1, tracking_id=1, stage1=[[0.0] * 106, [1.0] * 106],
                mapped=[[0.0] * 106, [1.0] * 106], tracked=[[0.0] * 106, [1.0] * 106],
                base_size=[120, 120], tracking_size=[160, 160], tracking_scale=1.0, frame_size=[480, 640])
    for name in ("forward", "inverse", "cached_forward", "cached_inverse", "detection_forward", "detection_inverse"):
        face[name] = deepcopy(affine)
    return dict(index=index, api="FsNew_DoPredict", rc=0, handle=8192,
                request=[0, 640, 480, 2560, 0], bytenn_sequence=16 * (index + 1), faces=[face],
                predictors=[dict(predictor=16384, provider=24576, network=32768, size=[120, 120]),
                            dict(predictor=40960, provider=49152, network=57344, size=[160, 160])],
                tables=dict(base=[0.5] * 212, tracking=[1.0] * 212, order=list(range(106))))


def inactive_row():
    row = geometry_row()
    face = row["faces"][0]
    for name in ("stage1", "mapped", "tracked"):
        face[name] = [[0.0] * 280 for _ in range(2)]
    face.update(active=False, id=-1, tracking_id=-1, frame_size=[0, 0], tracking_size=[0, 0], tracking_scale=0.0)
    row["faces"] = [dict(deepcopy(face), slot=slot, alignment=65536 + slot * 4096) for slot in range(10)]
    return row


class ContractTests(unittest.TestCase):
    def association_fixture(self):
        rows = [geometry_row(index=index) for index in range(2)]
        rows[0]["bytenn_sequence"], rows[1]["bytenn_sequence"] = 4, 8
        identities = [str(item["network"]) for item in rows[0]["predictors"]]
        networks = {identity: dict(successful_inferences=[0, 1, 2] if index == 0 else [0])
                    for index, identity in enumerate(identities)}
        metadata = [dict(index=index, kind="espresso-inference", fields=dict(self=identity, inference=str(inference), rc="0"))
                    for index, identity, inference in ((3, identities[0], 0), (4, identities[0], 1),
                                                       (7, identities[1], 0), (8, identities[0], 2))]
        return dict(records=rows, networks=networks, metadata=metadata)

    def test_validate_snapshot_accepts_active_and_all_ten_inactive_slots(self):
        for row in (geometry_row(), inactive_row()):
            contract.validate_snapshot(row=row)
        for name in ("stage1", "mapped", "tracked", "forward", "inverse"):
            row = geometry_row()
            row["faces"][0][name][0][0] = False
            with self.subTest(matrix=name), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)
        row = geometry_row()
        row["tables"]["base"][0] = 10**400
        with self.assertRaises(ValueError):
            contract.validate_snapshot(row=row)

    def test_snapshot_addresses_and_pool_slots_cannot_alias(self):
        for key in ("predictor", "provider", "network"):
            row = geometry_row()
            row["predictors"][1][key] = row["predictors"][0][key]
            with self.subTest(pointer=key), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)
        for slot, address in ((0, 69632), (1, 65536)):
            row = geometry_row()
            row["faces"].append(dict(deepcopy(row["faces"][0]), slot=slot, alignment=address))
            with self.subTest(slot=slot, address=address), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)

    def test_active_frame_dimensions_follow_height_width(self):
        for value in ([640, 480], [0, 0]):
            row = geometry_row()
            row["faces"][0]["frame_size"] = value
            with self.subTest(frame_size=value), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)
        row = geometry_row()
        row["faces"][0]["active"] = False
        contract.validate_snapshot(row=row)
        self.assertEqual(row["faces"][0]["id"], 1)
        self.assertEqual(row["faces"][0]["mapped"][1], [1.0] * 106)

    def test_sequence_canonicalizes_without_mutating_and_requires_stable_state(self):
        rows = [geometry_row(index=1), geometry_row(index=0)]
        before = deepcopy(rows)
        self.assertEqual([row["index"] for row in contract.validate_sequence(records=rows)], [0, 1])
        self.assertEqual(rows, before)
        changes = {"handle": 12288, "request": [0, 641, 480, 2564, 0], "bytenn_sequence": 16}
        for key, value in changes.items():
            changed = [geometry_row(), dict(geometry_row(index=1), **{key: value})]
            with self.subTest(field=key), self.assertRaises(ValueError):
                contract.validate_sequence(records=changed)
        for key in ("predictors", "tables"):
            changed = [geometry_row(), geometry_row(index=1)]
            if key == "tables":
                changed[1][key]["base"][0] = 0.6
            else:
                changed[1][key][0]["predictor"] += 4096
            with self.subTest(field=key), self.assertRaises(ValueError):
                contract.validate_sequence(records=changed)
        for records in (None, {}, [], [geometry_row()] * 65, [geometry_row(), geometry_row()]):
            with self.subTest(shape=type(records).__name__), self.assertRaises(ValueError):
                contract.validate_sequence(records=records)

    def test_actual_marker_windows_are_lower_inclusive_upper_exclusive(self):
        fixture = self.association_fixture()
        result = contract.associate_inferences(**fixture)
        self.assertEqual([item["neural_window"] for item in result], [[0, 4], [4, 8]])
        self.assertEqual([[item["record_index"] for item in row["inferences"]] for row in result], [[3], [4, 7]])
        self.assertEqual([[item["size"] for item in row["inferences"]] for row in result], [[120], [120, 160]])
        self.assertEqual(result[0]["inferences"][0]["network"], str(fixture["records"][0]["predictors"][0]["network"]))

    def test_missing_duplicate_or_failed_120_inference_and_missing_graph_are_rejected(self):
        for variant in ("missing", "duplicate", "failed", "graph"):
            fixture = self.association_fixture()
            if variant == "missing":
                fixture["metadata"].pop(0)
            elif variant == "duplicate":
                fixture["metadata"].append(dict(deepcopy(fixture["metadata"][0]), index=2))
            elif variant == "failed":
                fixture["metadata"][0]["fields"]["rc"] = "1"
            else:
                fixture["networks"].pop(fixture["metadata"][0]["fields"]["self"])
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                contract.associate_inferences(**fixture)

    def test_metadata_indices_fields_and_completed_inferences_are_strict(self):
        for field, value in (("index", False), ("index", 3.0), ("index", None),
                             ("fields", None), ("fields", {}), ("kind", None)):
            fixture = self.association_fixture()
            fixture["metadata"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                contract.associate_inferences(**fixture)
        for value in (True, 0.0, "-1", "999"):
            fixture = self.association_fixture()
            fixture["metadata"][0]["fields"]["inference"] = value
            with self.subTest(inference=value), self.assertRaises(ValueError):
                contract.associate_inferences(**fixture)
        fixture = self.association_fixture()
        fixture["networks"][fixture["metadata"][0]["fields"]["self"]]["successful_inferences"] = [0]
        with self.assertRaises(ValueError):
            contract.associate_inferences(**fixture)

    def test_duplicate_capture_indices_are_rejected_even_for_unrelated_record_kinds(self):
        fixture = self.association_fixture()
        fixture["metadata"].append(dict(index=3, kind="espresso-input", fields={}))
        with self.assertRaises(ValueError):
            contract.associate_inferences(**fixture)


if __name__ == "__main__":
    unittest.main()
