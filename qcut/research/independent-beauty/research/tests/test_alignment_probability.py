"""Synthetic native CPU classifier fixtures, without private model parameters."""
import hashlib
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alignment_probability import classification_probabilities, prepare_probability_head

RUNTIME = Path(__file__).resolve().parents[2] / 'runtime' / 'research'
HAS_MODELS = all((RUNTIME / f'face-align-{size}.onnx').is_file() for size in (120, 160))


def classifier_graph(*, classes=3, existing_features=False):
    import onnx
    helper = onnx.helper
    weights = np.zeros((128, classes), np.float32)
    bias = np.arange(classes, dtype=np.float32)
    initializers = [onnx.numpy_helper.from_array(value, name) for name, value in (
        ('weights', weights), ('bias', bias), ('shape', np.array([1, 1, 1, classes], np.int64)),
        ('axes', np.array([-1], np.int64)))]
    nodes = [helper.make_node(operation, inputs, [output]) for operation, inputs, output in (
        ('MatMul', ['features', 'weights'], 'product'), ('Add', ['product', 'bias'], 'biased'),
        ('Reshape', ['biased', 'shape'], 'logits'), ('ReduceMax', ['logits', 'axes'], 'max'),
        ('Sub', ['logits', 'max'], 'shifted'), ('Exp', ['shifted'], 'exp'),
        ('ReduceSum', ['exp', 'axes'], 'sum'), ('Div', ['exp', 'sum'], 'prob'))]
    feature = helper.make_tensor_value_info('features', onnx.TensorProto.FLOAT, [1, 128])
    outputs = [helper.make_tensor_value_info('prob', onnx.TensorProto.FLOAT, [1, 1, 1, classes])]
    if existing_features:
        outputs.append(feature)
    return helper.make_model(helper.make_graph(nodes, 'classifier', [feature], outputs, initializers),
                             opset_imports=[helper.make_opsetid('', 18)])


class ProbabilityHeadTests(unittest.TestCase):
    def test_native_three_and_five_class_terminals(self):
        # Actual libbytenn CPU InnerProduct + scalar Softmax on these public inputs.
        expected = {3: [1039171209, 1062118507, 1033526812],
                    5: [1040572400, 1029910551, 1058958713, 1042653934, 1023929567]}
        for classes, bits in expected.items():
            with self.subTest(classes=classes):
                features = np.float32((np.arange(128) * 13 % 29 - 14) / 8).reshape(1, 128)
                weights = np.float32((np.arange(128 * classes).reshape(128, classes) * 17 % 31 - 15) / 64)
                bias = np.float32(np.arange(classes) / 4 - .5)
                actual = classification_probabilities(features=features, parameters=(weights, bias))
                self.assertEqual(actual.shape, (1, 1, 1, classes))
                np.testing.assert_array_equal(actual.reshape(-1).view(np.uint32), bits)

    def test_native_fused_accumulation_and_small_probabilities(self):
        expected = {3: [764266422, 1065353216, 808953939],
                    5: [1050319833, 1050952564, 884083868, 876324163, 1052844195]}
        for classes, bits in expected.items():
            with self.subTest(classes=classes):
                rng = np.random.default_rng(1)
                features = rng.normal(0, 15, (1, 128)).astype(np.float32)
                weights = rng.normal(0, .07, (128, classes)).astype(np.float32)
                bias = rng.normal(0, .1, classes).astype(np.float32)
                actual = classification_probabilities(features=features, parameters=(weights, bias))
                np.testing.assert_array_equal(actual.reshape(-1).view(np.uint32), bits)

    def test_large_logits_are_shifted_before_exponentiation(self):
        features = np.zeros((1, 128), np.float32)
        weights = np.zeros((128, 3), np.float32)
        output = classification_probabilities(features=features, parameters=(weights, np.float32([-1000, 0, 1000])))
        np.testing.assert_array_equal(output.reshape(-1), [0, 0, 1])
        ties = classification_probabilities(features=features, parameters=(weights, np.zeros(3, np.float32)))
        np.testing.assert_array_equal(ties.reshape(-1), np.full(3, np.float32(1 / 3)))

    def test_rejects_incompatible_or_nonfinite_parameters(self):
        features = np.ones((1, 128), np.float32)
        weights, bias = np.ones((128, 3), np.float32), np.zeros(3, np.float32)
        for candidate, parameters in (
                (features.astype(np.float64), (weights, bias)),
                (np.full((1, 128), np.nan, np.float32), (weights, bias)),
                (features, (np.ones((128, 4), np.float32), np.zeros(4, np.float32))),
                (features, (np.full((128, 3), np.inf, np.float32), bias)),
                (features, (weights, np.full(3, np.nan, np.float32)))):
            with self.assertRaises(ValueError):
                classification_probabilities(features=candidate, parameters=parameters)

    def test_feature_output_is_added_once_and_weights_remain_private(self):
        import onnx
        for existing in (False, True):
            with self.subTest(existing=existing):
                data = classifier_graph(existing_features=existing).SerializeToString()
                digest = hashlib.sha256(data).digest()
                rewritten, feature, parameters = prepare_probability_head(data=data)
                outputs = [value.name for value in onnx.load_model_from_string(rewritten).graph.output]
                self.assertEqual(outputs, ['prob', 'features'])
                self.assertEqual(feature, 'features')
                self.assertEqual(hashlib.sha256(data).digest(), digest)
                self.assertTrue(all(not value.flags.writeable for value in parameters))
                result = classification_probabilities(features=np.ones((1, 128), np.float32), parameters=parameters)
                self.assertEqual(result.shape, (1, 1, 1, 3))

    def test_rejects_a_disconnected_softmax_or_wrong_class_count(self):
        graph = classifier_graph()
        graph.graph.node[-2].input[0] = 'logits'
        with self.assertRaisesRegex(ValueError, 'same logits'):
            prepare_probability_head(data=graph.SerializeToString())
        with self.assertRaisesRegex(ValueError, 'parameters'):
            prepare_probability_head(data=classifier_graph(classes=4).SerializeToString())

    @unittest.skipUnless(HAS_MODELS, 'runtime alignment models not installed')
    def test_locked_models_share_features_and_preserve_unselected_heads(self):
        from alignment_infer import Stage1
        for size in (120, 160):
            with self.subTest(size=size):
                model = RUNTIME / f'face-align-{size}.onnx'
                plain = Stage1(size=size, model=model)
                probability = Stage1(size=size, model=model, probability_heads=True)
                combined = Stage1(size=size, model=model, pose_heads=True, probability_heads=True)
                self.assertEqual(probability.feature_names, combined.feature_names)
                self.assertEqual(len(combined.feature_names), 1)
                dtype = np.int8 if size == 160 else np.int16
                tensor = np.random.default_rng(size).integers(-128, 128, (1, size, size, 3)).astype(dtype)
                original = plain.infer(tensor=tensor)
                classified = probability.infer(tensor=tensor)
                posed = combined.infer(tensor=tensor)
                for name in set(original) - {'prob'}:
                    np.testing.assert_array_equal(original[name], classified[name])
                for name in set(original) - {'fc_yaw', 'fc_pitch'}:
                    np.testing.assert_array_equal(classified[name], posed[name])
                np.testing.assert_allclose(original['prob'], classified['prob'], rtol=0, atol=1e-6)


if __name__ == '__main__':
    unittest.main()
