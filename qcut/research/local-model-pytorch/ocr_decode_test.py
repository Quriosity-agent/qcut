"""Authored synthetic alphabets only; no vendor class table in unit fixtures."""
import copy
import itertools
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from ocr_decode_contract import (DECODER, EVIDENCE_LEVEL, FORMAT, load_pinned_alphabet, mapping_digest,
                                 read_json, validate_manifest)
from ocr_decode_ctc import Alphabet, collapse_ids, decode_logits
from ocr_decode_metrics import aggregate_metrics, text_metrics


def fixture_metadata():
    tokens = [None, "A", "B", " ", "\u4e2d", "\u6587", "\U00020bb7", "e\u0301", "\u00e9"]
    return {"format": FORMAT, "profile": "authored-test-only", "local_only": True,
            "source_model_sha256": "1" * 64, "class_count": len(tokens), "tokens": tokens,
            "mapping_sha256": mapping_digest(tokens=tokens), "decoder": copy.deepcopy(DECODER),
            "evidence": {"level": EVIDENCE_LEVEL, "file": "evidence.json", "sha256": "2" * 64}}


def path_logits(*, ids, classes):
    logits = np.full((len(ids), classes), -10, dtype=np.float32)
    for step, class_id in enumerate(ids):
        logits[step, class_id] = 10
    return logits


class CTCTests(unittest.TestCase):
    def setUp(self):
        self.alphabet = Alphabet(tokens=(None, "A", "B", " ", "\u4e2d", "\u6587", "\U00020bb7", "e\u0301", "\u00e9"), blank_id=0)

    def decode(self, *, ids):
        return decode_logits(logits=path_logits(ids=ids, classes=len(self.alphabet.tokens)),
                             alphabet=self.alphabet, layout="TC")[0]

    def test_repetition_before_blank_removal(self):
        self.assertEqual(self.decode(ids=[1, 1, 0, 1, 1, 2, 0, 2])["text"], "AABB")

    def test_spans_preserve_original_time(self):
        result = self.decode(ids=[0, 1, 1, 0, 1, 0])
        self.assertEqual([(item["start"], item["end"]) for item in result["tokens"]], [(1, 3), (4, 5)])

    def test_blank_only_is_empty(self):
        result = self.decode(ids=[0, 0, 0])
        self.assertEqual(result["text"], "")
        self.assertEqual(result["tokens"], [])
        self.assertIsNone(result["emission_geometric_mean"])

    def test_empty_id_stream_is_legal(self):
        self.assertEqual(collapse_ids(ids=[], alphabet=self.alphabet), [])

    def test_whitespace_is_not_trimmed(self):
        self.assertEqual(self.decode(ids=[3, 0, 3, 1, 3])["text"], "  A ")

    def test_bilingual_unicode_astral_and_combining(self):
        result = self.decode(ids=[4, 5, 1, 6, 7, 8])
        self.assertEqual(result["text"], "\u4e2d\u6587A\U00020bb7e\u0301\u00e9")

    def test_duplicate_spellings_merge_by_id_not_text(self):
        alphabet = Alphabet(tokens=(None, " ", " "), blank_id=0)
        result = decode_logits(logits=path_logits(ids=[1, 2, 2, 1], classes=3), alphabet=alphabet, layout="TC")
        self.assertEqual(result[0]["text"], "   ")
        self.assertEqual([item["id"] for item in result[0]["tokens"]], [1, 2, 1])

    def test_nonzero_blank(self):
        alphabet = Alphabet(tokens=("A", "B", None), blank_id=2)
        self.assertEqual([item["text"] for item in collapse_ids(ids=[0, 0, 2, 0], alphabet=alphabet)], ["A", "A"])

    def test_first_index_wins_ties(self):
        logits = np.zeros((2, 9), dtype=np.float32)
        logits[:, 1:3] = 5
        result = decode_logits(logits=logits, alphabet=self.alphabet, layout="TC")[0]
        self.assertEqual(result["text"], "A")
        self.assertEqual(result["ids"], [1, 1])

    def test_no_automatic_axis_guess(self):
        with self.assertRaises(ValueError):
            decode_logits(logits=np.zeros((9, 9), np.float32), alphabet=self.alphabet, layout="auto")

    def test_layouts_match(self):
        tc = path_logits(ids=[1, 0, 2, 4], classes=9)
        cases = {"TC": tc, "NTC": tc[None], "NCT": tc.T[None], "NCHW": tc.T[None, :, None]}
        for layout, values in cases.items():
            with self.subTest(layout=layout):
                self.assertEqual(decode_logits(logits=values, alphabet=self.alphabet, layout=layout)[0]["text"], "AB\u4e2d")

    def test_batch_lengths_and_zero_valid_steps(self):
        values = np.stack([path_logits(ids=[1, 0, 2], classes=9)] * 2)
        results = decode_logits(logits=values, alphabet=self.alphabet, layout="NTC", lengths=[1, 0])
        self.assertEqual([result["text"] for result in results], ["A", ""])

    def test_invalid_lengths(self):
        for lengths in ([True], [-1], [4], [1.5], [], [1, 2], "1"):
            with self.subTest(lengths=lengths), self.assertRaises(ValueError):
                decode_logits(logits=np.zeros((3, 9), np.float32), alphabet=self.alphabet, layout="TC", lengths=lengths)

    def test_invalid_dimensions(self):
        for shape in ((0, 9), (1, 8), (4097, 9), (0, 1, 9), (33, 1, 9), (1, 9, 2, 3)):
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                decode_logits(logits=np.zeros(shape, np.float32), alphabet=self.alphabet,
                              layout={2: "TC", 3: "NTC", 4: "NCHW"}[len(shape)])

    def test_bad_dtype_and_nonfinite(self):
        values = [np.zeros((1, 9), dtype) for dtype in (np.float64, np.int16, object)]
        values.extend(np.full((1, 9), value, np.float32) for value in (np.nan, np.inf, -np.inf))
        values.append([[0] * 9])
        for value in values:
            with self.subTest(dtype=getattr(value, "dtype", None)), self.assertRaises(ValueError):
                decode_logits(logits=value, alphabet=self.alphabet, layout="TC")

    def test_strided_logits(self):
        value = path_logits(ids=[1, 0, 1, 0, 2, 0], classes=9)[::2]
        self.assertFalse(value.flags.c_contiguous)
        self.assertEqual(decode_logits(logits=value, alphabet=self.alphabet, layout="TC")[0]["text"], "AB")

    def test_extreme_logits_have_finite_score(self):
        value = np.full((2, 9), -np.finfo(np.float32).max, np.float32)
        value[:, 1] = np.finfo(np.float32).max
        self.assertEqual(decode_logits(logits=value, alphabet=self.alphabet, layout="TC")[0]["emission_geometric_mean"], 1)

    def test_ids_reject_bool_float_negative_or_out_of_range(self):
        for ids in ([True], [1.0], [-1], [9], np.array([1])):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                collapse_ids(ids=ids, alphabet=self.alphabet)

    def test_alphabet_invalid_blank_and_tokens(self):
        for tokens, blank in (([None, "A"], 0), ((None,), 0), ((None, "A"), True), ((None, "A"), 2),
                              (("", "A"), 0), ((None, ""), 0), ((None, None), 0), ((None, "\ud800"), 0),
                              ((None, "\x00"), 0), ((None, "x" * 17), 0), ((None, 1), 0)):
            with self.subTest(tokens=tokens, blank=blank), self.assertRaises(ValueError):
                Alphabet(tokens=tokens, blank_id=blank)

    def test_exhaustive_small_path_reference(self):
        alphabet = Alphabet(tokens=(None, "A", "B"), blank_id=0)
        for length in range(8):
            for ids in itertools.product(range(3), repeat=length):
                expected = "".join(alphabet.tokens[key] for key, _ in itertools.groupby(ids) if key != 0)
                actual = "".join(item["text"] for item in collapse_ids(ids=ids, alphabet=alphabet))
                self.assertEqual(actual, expected)


class ContractTests(unittest.TestCase):
    def validate(self, *, metadata):
        return validate_manifest(metadata=metadata, expected_source_sha256="1" * 64,
                                 expected_mapping_sha256=fixture_metadata()["mapping_sha256"])

    def test_authored_manifest(self):
        self.assertEqual(self.validate(metadata=fixture_metadata()).tokens[4], "\u4e2d")

    def test_source_hash_pinning(self):
        metadata = fixture_metadata()
        metadata["source_model_sha256"] = "3" * 64
        with self.assertRaises(ValueError):
            self.validate(metadata=metadata)

    def test_swapped_alphabet_even_with_self_updated_hash(self):
        metadata = fixture_metadata()
        metadata["tokens"][1], metadata["tokens"][2] = metadata["tokens"][2], metadata["tokens"][1]
        metadata["mapping_sha256"] = mapping_digest(tokens=metadata["tokens"])
        with self.assertRaises(ValueError):
            self.validate(metadata=metadata)

    def test_token_mutation_without_hash(self):
        metadata = fixture_metadata()
        metadata["tokens"][1] = "C"
        with self.assertRaises(ValueError):
            self.validate(metadata=metadata)

    def test_class_count_exact_integer(self):
        for value in (True, 9.0, 8, 10, 0):
            metadata = fixture_metadata()
            metadata["class_count"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(metadata=metadata)

    def test_missing_and_unknown_fields(self):
        metadata = fixture_metadata()
        for invalid in ({key: value for key, value in metadata.items() if key != "evidence"}, {**metadata, "verified": True}):
            with self.assertRaises(ValueError):
                self.validate(metadata=invalid)

    def test_unverified_evidence_gate(self):
        for level in ("candidate", "fixture-derived", "same-class-count", "", True):
            metadata = fixture_metadata()
            metadata["evidence"]["level"] = level
            with self.subTest(level=level), self.assertRaises(ValueError):
                self.validate(metadata=metadata)

    def test_decoder_options_are_explicit_and_closed(self):
        for key, value in (("merge_repeated", False), ("merge_repeated", 1), ("blank_id", False),
                            ("normalization", "NFKC"), ("time_direction", "reverse"), ("tie_break", "last-index"),
                            ("algorithm", "beam-search"), ("unknown", True)):
            metadata = fixture_metadata()
            metadata["decoder"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(metadata=metadata)

    def test_adjacent_evidence_no_traversal(self):
        for path in ("../evidence.json", "/tmp/evidence.json", "sub/evidence.json", "evidence.json/", "file.txt"):
            metadata = fixture_metadata()
            metadata["evidence"]["file"] = path
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.validate(metadata=metadata)

    def test_missing_evidence_hash(self):
        metadata = fixture_metadata()
        metadata["evidence"]["sha256"] = "unknown"
        with self.assertRaises(ValueError):
            self.validate(metadata=metadata)

    def test_local_only_literal_true(self):
        for flag in (False, 1, "true"):
            metadata = fixture_metadata()
            metadata["local_only"] = flag
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                self.validate(metadata=metadata)

    def test_requires_expected_hashes(self):
        for bad in ("", "f" * 63, "F" * 64, None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_manifest(metadata=fixture_metadata(), expected_source_sha256=bad,
                                  expected_mapping_sha256=fixture_metadata()["mapping_sha256"])

    def test_json_duplicate_nonfinite_and_nonobject(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.json"
            for text in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '[]'):
                path.write_text(text)
                with self.subTest(text=text), self.assertRaises(ValueError):
                    read_json(path=path)

    def test_json_size_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.json"
            path.write_text(" ")
            alias = path.with_name("alias.json")
            alias.symlink_to(path)
            with self.assertRaises(ValueError):
                read_json(path=alias)
            path.write_bytes(b" " * (2 * 1024**2 + 1))
            with self.assertRaises(ValueError):
                read_json(path=path)

    def test_pinned_loader_rejects_authored_synthetic_dictionary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "alphabet.json"
            path.write_text(json.dumps(fixture_metadata()))
            with self.assertRaises(ValueError):
                load_pinned_alphabet(path=path)


class MetricTests(unittest.TestCase):
    def test_insert_delete_substitute(self):
        for actual, expected, edits in (("abc", "abc", 0), ("abc", "ab", 1), ("ab", "abc", 1), ("axc", "abc", 1)):
            self.assertEqual(text_metrics(actual=actual, expected=expected)["edit_distance"], edits)

    def test_unicode_counts_codepoints_not_utf8_bytes(self):
        value = text_metrics(actual="\u4e2d\U00020bb7", expected="\u4e2d\u6587")
        self.assertEqual(value["reference_codepoints"], 2)
        self.assertEqual(value["cer"], 0.5)

    def test_no_normalization_correction_or_whitespace_stripping(self):
        for actual, expected in (("A", "a"), ("a", " a "), (",", "\uff0c"), ("\u00e9", "e\u0301")):
            self.assertFalse(text_metrics(actual=actual, expected=expected)["exact"])

    def test_empty_reference_no_fake_zero_cer(self):
        self.assertIsNone(text_metrics(actual="x", expected="")["cer"])
        self.assertTrue(text_metrics(actual="", expected="")["exact"])

    def test_micro_average_not_mean_of_ratios(self):
        result = aggregate_metrics(cases=[text_metrics(actual="a", expected="a"), text_metrics(actual="x", expected="abcdefghij")])
        self.assertEqual(result["cer"], 10 / 11)

    def test_empty_or_invalid_corpus_rejected(self):
        with self.assertRaises(ValueError):
            aggregate_metrics(cases=[])
        with self.assertRaises(ValueError):
            text_metrics(actual=123, expected="a")


if __name__ == "__main__":
    unittest.main()
