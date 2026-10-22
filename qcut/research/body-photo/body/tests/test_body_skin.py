import unittest

import numpy as np
from PIL import Image, ImageDraw

from body.body_skin import apply_body_skin
from body.skin_mask import build_skin_mask, rgb_to_lab


def scene(*, skin=(188, 132, 105), textured=False):
    width, height = 192, 256
    image = Image.new("RGBA", (width, height), (35, 60, 90, 255))
    draw = ImageDraw.Draw(image)
    silhouette = Image.new("L", (width, height))
    person = ImageDraw.Draw(silhouette)
    shapes = [("ellipse", (72, 12, 120, 70)), ("rectangle", (72, 78, 120, 158)),
              ("line", ((70, 83), (55, 120), (52, 155))),
              ("line", ((122, 83), (137, 120), (140, 155))),
              ("line", ((82, 152), (82, 235))), ("line", ((110, 152), (110, 235)))]
    for method, coordinates in shapes:
        arguments = {"fill": (*skin, 255)}
        if method == "line":
            arguments["width"] = 15
        getattr(draw, method)(coordinates, **arguments)
        getattr(person, method)(coordinates, **{**arguments, "fill": 255})
    draw.rectangle((72, 80, 120, 159), fill=(30, 65, 135, 255))
    rgba = np.array(image)
    if textured:
        selected = np.all(rgba[..., :3] == skin, axis=-1)
        noise = np.random.default_rng(123).integers(-7, 8, (height, width, 1))
        rgb = np.clip(rgba[..., :3].astype(np.int16) + noise, 0, 255).astype(np.uint8)
        rgba[..., :3][selected] = rgb[selected]
    pose = np.zeros((18, 4), np.float32)
    joints = {0: (96, 37), 1: (96, 75), 2: (70, 83), 3: (55, 120), 4: (52, 155),
              5: (122, 83), 6: (137, 120), 7: (140, 155), 8: (82, 155), 9: (82, 198),
              10: (82, 235), 11: (110, 155), 12: (110, 198), 13: (110, 235)}
    for index, point in joints.items():
        pose[index] = [*point, .95, 1]
    angle = np.linspace(0, np.pi * 2, 106, endpoint=False)
    faces = {"box": [72, 12, 48, 58], "score": .95,
             "landmarks": np.column_stack((96 + 23 * np.cos(angle), 41 + 28 * np.sin(angle)))}
    return {"rgba": rgba, "person_mask": np.array(silhouette), "pose": pose,
            "algorithm_size": (width, height), "faces": faces}


class BodySkinTests(unittest.TestCase):
    def test_zero_without_perception_is_exact_and_independent_copy(self):
        data = scene()
        original = data["rgba"].copy()
        data.update(person_mask=None, pose=None, faces=None, algorithm_size=None)
        result, parts = apply_body_skin(**data, controls={})
        np.testing.assert_array_equal(result, original)
        self.assertIsNot(result, data["rgba"])
        self.assertTrue(all(not part["moved"] for part in parts.values()))

    def test_light_and_dark_skin_change_in_both_directions(self):
        for skin in ((218, 170, 145), (82, 49, 34), (52, 34, 27)):
            with self.subTest(skin=skin):
                data = scene(skin=skin)
                mask, selection = build_skin_mask(**data)
                self.assertTrue(selection["available"])
                source = rgb_to_lab(rgb=data["rgba"][..., :3])[..., 0][mask > .8].mean()
                samples = []
                for value in (-50, -25, 25, 50):
                    result, parts = apply_body_skin(**data, controls={"BodySkinTone": value})
                    self.assertTrue(parts["BodySkinTone"]["moved"])
                    samples.append(rgb_to_lab(rgb=result[..., :3])[..., 0][mask > .8].mean())
                self.assertTrue(samples[0] < samples[1] < source < samples[2] < samples[3])

    def test_clothing_background_and_head_stay_exact(self):
        data = scene(textured=True)
        result, parts = apply_body_skin(**data, controls={"BodySkinTone": 50, "BodySkinWarmth": 50,
                                                        "BodySkinSmooth": 100, "BodyBlemish": 100})
        source = data["rgba"]
        np.testing.assert_array_equal(result[:74], source[:74])
        np.testing.assert_array_equal(result[85:153, 76:118], source[85:153, 76:118])
        np.testing.assert_array_equal(result[data["person_mask"] == 0], source[data["person_mask"] == 0])
        self.assertEqual(parts["BodySkinTone"]["changedProtectedPixels"], 0)
        self.assertFalse(parts["BodyBlemish"]["textureGenerated"])

    def test_alpha_unchanged_and_transparent_pixels_not_selected(self):
        data = scene()
        data["rgba"][180:190, 78:88, 3] = 100
        result, _ = apply_body_skin(**data, controls={"BodySkinTone": 50})
        np.testing.assert_array_equal(result[..., 3], data["rgba"][..., 3])
        np.testing.assert_array_equal(result[180:190, 78:88], data["rgba"][180:190, 78:88])

    def test_warm_and_cool_change_opponent_colour(self):
        data = scene(skin=(82, 49, 34))
        mask, _ = build_skin_mask(**data)
        measured = []
        for value in (-50, 0, 50):
            result, _ = apply_body_skin(**data, controls={"BodySkinWarmth": value})
            measured.append(rgb_to_lab(rgb=result[..., :3])[..., 2][mask > .8].mean())
        self.assertTrue(measured[0] < measured[1] < measured[2])

    def test_smooth_reduces_high_frequency_texture(self):
        data = scene(textured=True)
        result, parts = apply_body_skin(**data, controls={"BodySkinSmooth": 100})
        before = data["rgba"][173:225, 79:85, :3].astype(float)
        after = result[173:225, 79:85, :3].astype(float)
        self.assertTrue(parts["BodySkinSmooth"]["moved"])
        self.assertLess(np.std(after), np.std(before))

    def test_small_dark_spot_softens_without_inventing_texture(self):
        data = scene()
        data["rgba"][188, 82, :3] -= 20
        result, parts = apply_body_skin(**data, controls={"BodyBlemish": 100})
        self.assertTrue(parts["BodyBlemish"]["moved"])
        self.assertGreater(result[188, 82, :3].astype(int).sum(), data["rgba"][188, 82, :3].astype(int).sum())
        self.assertFalse(parts["BodyBlemish"]["textureGenerated"])

    def test_blemish_hole_support_is_reported_and_other_controls_keep_base_mask(self):
        data = scene()
        for name in ("rgba", "person_mask"):
            data[name] = np.array(Image.fromarray(data[name]).resize((576, 768), Image.Resampling.NEAREST))
        data["pose"][:, :2] *= 3
        data["algorithm_size"] = (576, 768)
        data["faces"]["box"] = np.asarray(data["faces"]["box"]) * 3
        data["faces"]["landmarks"] *= 3
        data["rgba"][563:566, 245:248, :3] = (45, 30, 20)
        base_mask, _ = build_skin_mask(**data)
        self.assertEqual(base_mask[564, 246], 0)
        result, parts = apply_body_skin(**data, controls={"BodyBlemish": 100})
        part = parts["BodyBlemish"]
        self.assertEqual(part["blemishDetection"]["additionalSupportPixels"], 9)
        self.assertEqual(part["changedProtectedPixels"], 0)
        self.assertGreater(int(result[564, 246, :3].sum()), int(data["rgba"][564, 246, :3].sum()))
        expected_support = base_mask > 0
        expected_support[563:566, 245:248] = True
        np.testing.assert_array_equal(result[~expected_support], data["rgba"][~expected_support])
        np.testing.assert_array_equal(result[..., 3], data["rgba"][..., 3])
        for control in ("BodySkinTone", "BodySkinWarmth", "BodySkinSmooth"):
            output, _ = apply_body_skin(**data, controls={control: 50})
            np.testing.assert_array_equal(output[base_mask == 0], data["rgba"][base_mask == 0])

    def test_missing_or_unreliable_seeds_fail_closed(self):
        for faces in (None, {}, {"score": .1}, {"score": float("nan")}):
            data = scene()
            data["faces"] = faces
            result, parts = apply_body_skin(**data, controls={"BodySkinTone": 50})
            np.testing.assert_array_equal(result, data["rgba"])
            self.assertFalse(parts["BodySkinTone"]["moved"])
            self.assertIsNotNone(parts["BodySkinTone"]["reasonCode"])

    def test_invalid_controls_are_rejected(self):
        for value in (True, float("nan"), float("inf"), "20", -51, 51):
            with self.subTest(value=value), self.assertRaises(ValueError):
                apply_body_skin(**scene(), controls={"BodySkinTone": value})

    def test_hashes_and_non_mutation(self):
        data = scene()
        original = data["rgba"].copy()
        first, a = apply_body_skin(**data, controls={"BodySkinTone": 30})
        second, b = apply_body_skin(**data, controls={"BodySkinTone": 30})
        np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(data["rgba"], original)
        self.assertEqual(a, b)
        self.assertEqual(len(a["BodySkinTone"]["skinSelection"]["maskSha256"]), 64)


if __name__ == "__main__":
    unittest.main()
