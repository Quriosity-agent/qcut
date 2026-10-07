"""Independent single-frame perspective fitting of the pinned 221-point model."""
import numpy as np

from facefitting_geometry import reconstruct
from facefitting_pose import camera_parameters, project, rodrigues


def _rotation_vector(*, matrix):
    cosine = np.clip((np.trace(matrix) - 1) / 2, -1, 1)
    angle = np.arccos(cosine)
    if angle < 1e-8:
        return np.array([matrix[2, 1] - matrix[1, 2], matrix[0, 2] - matrix[2, 0], matrix[1, 0] - matrix[0, 1]]) / 2
    if np.pi - angle < 1e-5:
        values, vectors = np.linalg.eigh((matrix + matrix.T) / 2)
        axis = vectors[:, np.argmax(values)]
        differences = np.array([matrix[2, 1] - matrix[1, 2], matrix[0, 2] - matrix[2, 0], matrix[1, 0] - matrix[0, 1]])
        if axis @ differences < 0:
            axis = -axis
        return axis * angle
    return angle / (2 * np.sin(angle)) * np.array([matrix[2, 1] - matrix[1, 2], matrix[0, 2] - matrix[2, 0], matrix[1, 0] - matrix[0, 1]])


def _pose_step(*, rotation, translation, step):
    delta_rotation = rodrigues(vector=step[:3])
    theta = np.linalg.norm(step[:3])
    x, y, z = step[:3]
    skew = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    if theta < 1e-6:
        velocity = np.eye(3)
    else:
        velocity = np.eye(3) + (1 - np.cos(theta)) / theta ** 2 * skew + (theta - np.sin(theta)) / theta ** 3 * (skew @ skew)
    return delta_rotation @ rotation, delta_rotation @ translation + velocity @ step[3:6]


def _projection_system(*, vertices, rotation, translation, camera):
    xyz = vertices @ rotation.T + translation
    x, y, z = xyz.T
    if np.any(np.abs(z) < 1e-6) or not np.isfinite(xyz).all():
        raise ValueError('fitting crossed the camera plane')
    focal = float(camera[0])
    predicted = xyz[:, :2] / z[:, None] * focal + camera[1:]
    derivative = np.zeros((len(vertices), 2, 6))
    divisor = focal / (z + 1e-8)
    depth_derivative = focal / (z * z + 1e-8)
    derivative[:, 0] = np.column_stack((-x * y * depth_derivative, focal + x * x * depth_derivative,
                                        -y * divisor, divisor, np.zeros(len(x)), -x * depth_derivative))
    derivative[:, 1] = np.column_stack((-focal - y * y * depth_derivative, x * y * depth_derivative,
                                        x * divisor, np.zeros(len(x)), divisor, -y * depth_derivative))
    camera_derivative = np.zeros((len(vertices), 2, 3))
    camera_derivative[:, 0, 0] = divisor
    camera_derivative[:, 1, 1] = divisor
    camera_derivative[:, 0, 2] = -x * depth_derivative
    camera_derivative[:, 1, 2] = -y * depth_derivative
    return predicted, derivative, camera_derivative


def _initial_pose(*, vertices, target, camera):
    homogeneous = np.column_stack((vertices, np.ones(len(vertices))))
    normalized = (target - camera[1:]) / camera[0]
    zero = np.zeros_like(homogeneous)
    design = np.stack((np.column_stack((homogeneous, zero, -normalized[:, 0, None] * homogeneous)),
                       np.column_stack((zero, homogeneous, -normalized[:, 1, None] * homogeneous))), axis=1).reshape(-1, 12)
    _, _, right = np.linalg.svd(design, full_matrices=False)
    projection = right[-1].reshape(3, 4)
    if np.linalg.det(projection[:, :3]) < 0:
        projection = -projection
    left, singular, right = np.linalg.svd(projection[:, :3])
    rotation = left @ right
    translation = projection[:, 3] / singular.mean()
    for _ in range(40):
        predicted, jacobian, _ = _projection_system(vertices=vertices, rotation=rotation, translation=translation, camera=camera)
        residual = (predicted - target).reshape(-1)
        jacobian = jacobian.reshape(-1, 6)
        step = np.linalg.lstsq(jacobian, -residual, rcond=1e-10)[0]
        rotation, translation = _pose_step(rotation=rotation, translation=translation, step=step)
        if np.linalg.norm(step) < 1e-8:
            break
    return rotation, translation


def solve(*, model, points, size, fov_degrees=53.13010235415598, iterations=10):
    points = np.asarray(points)
    if points.dtype != np.float32 or points.shape != (221, 2) or not np.isfinite(points).all() or np.abs(points).max() > 1e6:
        raise ValueError('expected 221 finite bounded float32 XY points')
    if np.linalg.matrix_rank(points.astype(np.float64) - points.mean(axis=0)) < 2:
        raise ValueError('degenerate fitting points')
    if type(iterations) is not int or not 1 <= iterations <= 100:
        raise ValueError('iterations must be between 1 and 100')
    camera = camera_parameters(size=size, fov_degrees=fov_degrees)
    target = points.astype(np.float64).copy()
    target[:, 1] = size[1] - target[:, 1]
    basis = model.landmark_basis.astype(np.float64)
    coefficients = np.r_[1.0, np.zeros(81)]
    rotation, translation = _initial_pose(vertices=basis[0], target=target, camera=camera)
    weights = model.point_weights.astype(np.float64)
    priors = model.coefficient_weights[1:].astype(np.float64)
    previous_loss = np.inf
    history = []
    for iteration in range(iterations):
        vertices = np.einsum('b,bpc->pc', coefficients, basis)
        predicted, pose_derivative, projection_derivative = _projection_system(vertices=vertices, rotation=rotation, translation=translation, camera=camera)
        data_residual = ((predicted - target) * weights[:, None]).reshape(-1)
        prior_residual = coefficients[1:] * priors
        residual = np.r_[data_residual, prior_residual]
        loss = residual @ residual / 2
        history.append(float(loss))
        if iteration > 0 and (loss < 0.5 or abs(loss - previous_loss) / previous_loss < 0.01):
            break
        previous_loss = loss
        shape_derivative = np.einsum('pdc,ci,bpi->pdb', projection_derivative, rotation, basis[1:])
        data_jacobian = np.concatenate((pose_derivative, shape_derivative), axis=2) * weights[:, None, None]
        data_jacobian = data_jacobian.reshape(442, 87)
        prior_jacobian = np.column_stack((np.zeros((81, 6)), np.diag(priors)))
        jacobian = np.vstack((data_jacobian, prior_jacobian))
        # The native Jacobian and its column normalization both accumulate in float32.
        jacobian = jacobian.astype(np.float32)
        norms = np.linalg.norm(jacobian, axis=0)
        norms[-3:] = np.sum(jacobian[:, -3:] ** 2, axis=0)
        scaling = 1 / (norms + 1)
        scaled = jacobian * scaling
        normal = scaled.T @ scaled + np.diag(norms * scaling / (10000 * (iteration + 1)))
        step = -np.linalg.solve(normal, scaled.T @ residual.astype(np.float32)) * scaling
        rotation, translation = _pose_step(rotation=rotation, translation=translation, step=step)
        coefficients[1:] += step[6:]
        if not np.isfinite(coefficients).all():
            raise ValueError('nonfinite fitting coefficients')
    pose = np.r_[_rotation_vector(matrix=rotation), translation]
    coefficients = coefficients.astype(np.float32)
    geometry = reconstruct(model=model, coefficients=coefficients)
    projected = project(vertices=geometry['landmarks'], pose=pose, camera=camera, height=size[1])
    return {**geometry, **projected, 'coefficients': coefficients, 'pose': pose, 'camera': camera,
            'loss_history': history, 'iterations': len(history)}
