"""Perspective projection in the native solver's Rodrigues and image conventions."""
import numpy as np


def camera_parameters(*, size, fov_degrees=53.13010235415598):
    if len(size) != 2 or any(type(value) is not int or not 100 < value < 10000 for value in size):
        raise ValueError('expected integer image dimensions between 101 and 9999')
    if not np.isfinite(fov_degrees) or not 1 <= fov_degrees <= 90:
        raise ValueError('camera field of view must be between 1 and 90 degrees')
    width, height = size
    return np.array([height / (2 * np.tan(np.deg2rad(fov_degrees) / 2)), width / 2, height / 2], np.float32)


def rodrigues(*, vector):
    vector = np.asarray(vector, np.float64)
    if vector.shape != (3,) or not np.isfinite(vector).all() or np.linalg.norm(vector) > 100:
        raise ValueError('expected a finite bounded Rodrigues vector')
    x, y, z = vector
    skew = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]], np.float64)
    theta = np.linalg.norm(vector)
    if theta < 1e-8:
        return np.eye(3) + skew + 0.5 * skew @ skew
    return np.eye(3) + (np.sin(theta) / theta) * skew + ((1 - np.cos(theta)) / theta ** 2) * skew @ skew


def project(*, vertices, pose, camera, height):
    vertices, pose, camera = np.asarray(vertices), np.asarray(pose), np.asarray(camera)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all():
        raise ValueError('expected finite XYZ vertices')
    if pose.shape != (6,) or not np.isfinite(pose).all() or np.abs(pose[3:]).max() > 1e6:
        raise ValueError('expected a finite bounded six-value pose')
    if camera.shape != (3,) or not np.isfinite(camera).all() or camera[0] <= 0 or not np.isfinite(height) or height <= 0:
        raise ValueError('invalid camera or image height')
    transformed = vertices.astype(np.float64) @ rodrigues(vector=pose[:3]).T + pose[3:]
    if np.any(np.abs(transformed[:, 2]) < 1e-6):
        raise ValueError('projection crosses the camera plane')
    points = transformed[:, :2] / transformed[:, 2, None] * camera[0] + camera[1:]
    # The 3D stage uses bottom-left image coordinates internally, unlike the network remap.
    points[:, 1] = height - points[:, 1]
    if not np.isfinite(points).all():
        raise ValueError('nonfinite projected points')
    return {'image_points': points.astype(np.float32), 'camera_vertices': transformed.astype(np.float32)}
