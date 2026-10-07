"""Original photo to owned classical mesh, normals and camera matrices."""
import numpy as np

from facefitting1256_frontend import predict_fitting_photo
from facefitting1256_geometry import landmark_basis, mesh_normals
from facefitting1256_model import load_model, MODEL_NAME, MODEL_SHA256
from facefitting1256_solver import classical_camera, fit_frame
from facefitting_pose import rodrigues
from facefitting_solver import _initial_pose, _rotation_vector

F = np.float32


def fit_photo(*, rgba, runtime):
    prediction = predict_fitting_photo(rgba=rgba, model_root=runtime/'research')
    size = tuple(prediction['algorithmSize'])
    model = load_model(path=runtime/'Models'/MODEL_NAME)
    coefficients = np.r_[F(1), np.zeros(69, F)]
    neutral = coefficients.copy()
    pose = np.asarray([0., 0., 0., 0., 0., 1.])
    basis = landmark_basis(model=model, coefficients=coefficients, pose=pose)
    target = np.asarray(prediction['passes'][0]['points'], F)[model['indices'][1:69]].astype(np.float64)
    target[:, 1] = size[1]-target[:, 1]
    rotation, translation = _initial_pose(vertices=basis[0].astype(np.float64), target=target,
        camera=classical_camera(size=size).astype(np.float64))
    pose = F(np.r_[_rotation_vector(matrix=rotation), translation]).astype(np.float64)
    history = []
    # Contour support follows the camera, but its normal tests use the neutral mesh.
    for frame in prediction['passes']:
        basis = landmark_basis(model=model, coefficients=neutral, pose=pose)
        coefficients, pose, loss = fit_frame(model=model, basis=basis,
            points=np.asarray(frame['points'], F)[:106], pose=pose, coefficients=coefficients, size=size)
        history.append(loss)
    vertices = F(coefficients@model['basis'].reshape(70, -1)).reshape(1463, 3)
    normal = mesh_normals(vertices=vertices, triangles=model['triangles'])
    transform = np.eye(4, dtype=F)
    transform[:3, :3] = rodrigues(vector=pose[:3]).astype(F)
    transform[:3, 3] = pose[3:]
    transform[:2] *= F(-1)
    projection = np.asarray([[2*max(size)/size[0], 0, 0, 0], [0, 2*max(size)/size[1], 0, 0],
        [0, 0, -1.002002, -2.002002], [0, 0, -1, 0]], F)
    mesh = np.column_stack([vertices, model['uv'], normal]).astype(F)
    receipt = {'modelSha256': MODEL_SHA256, 'vertices': 1463, 'triangles': 2376,
        'coefficients': coefficients.tolist(), 'pose': pose.tolist(), 'loss': history,
        'fixedLandmarks': False, 'nativeGeometryUsed': False, 'extra': prediction}
    return {'vertices': mesh, 'triangles': model['triangles'], 'model': transform,
            'mvp': F(projection@transform)}, receipt
