"""Owned 512-square spot/acne crop from independently predicted Base106."""
from nh_geometry import crop_transform


def crop(*, points, mean):
    return crop_transform(points=points, mean=mean, size=512, margin=.46, offset_y=50)
