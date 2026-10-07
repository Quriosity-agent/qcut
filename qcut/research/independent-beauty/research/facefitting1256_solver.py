"""Bounded joint pose/shape LM solve for the pinned 68-landmark classical model."""
import numpy as np

from facefitting_pose import rodrigues
from facefitting_solver import _pose_step, _projection_system, _rotation_vector

F = np.float32


def classical_camera(*, size):
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(side) is not int or not 1 <= side <= 4096 for side in size)):
        raise ValueError('bounded classical camera dimensions required')
    return np.asarray([max(size), size[0]//2, size[1]//2], F)


def fit_frame(*, model, basis, points, pose, coefficients, size):
    target = points[model['indices'][1:69]].astype(F)
    target[:, 1] = F(size[1])-target[:, 1]
    camera = classical_camera(size=size)
    weights, priors = model['weights'], model['priors'][1:]
    rotation, translation = rodrigues(vector=pose[:3]), pose[3:].copy()
    result, last_loss, history = coefficients.copy(), F(np.finfo(F).max), []
    for iteration in range(5):
        vertices = F(result@basis.reshape(70, -1)).reshape(68, 3)
        predicted, derivative, projection = _projection_system(vertices=vertices, rotation=rotation,
            translation=translation, camera=camera)
        predicted, derivative, projection = F(predicted), F(derivative), F(projection)
        residual = F((predicted-target)*weights[:, None]).reshape(-1)
        loss = F(np.sum(residual**2, dtype=F))
        history.append(float(loss))
        if loss < 1 or F(abs(F(loss-last_loss))/last_loss) < F(.05):
            break
        last_loss = loss
        shape = np.einsum('pdc,ci,bpi->pdb', projection, rotation, basis[1:])
        # Pose columns remain unweighted in the pinned native solver.
        data = F(np.concatenate((derivative, shape*weights[:, None, None]), axis=2)).reshape(136, 75)
        prior = np.column_stack((np.zeros((69, 6), F), np.diag(priors)))
        jacobian = np.vstack([data, prior])
        norms = F(np.sqrt(np.sum(jacobian.astype(np.float64)**2, axis=0)))
        scale = F(F(1)/F(norms+F(1)))
        scaled = F(jacobian*scale)
        normal = F(scaled[:136].T@scaled[:136])
        normal += np.diag(F(F(norms*scale)/F(1000*(iteration+1))))
        normal += np.diag(np.r_[np.zeros(6, F), F(F(priors*scale[6:])**2)])
        rhs = F(scaled[:136].T@residual)
        rhs[6:] += F(F(priors*scale[6:])*F(priors*result[1:]))
        step = F(-np.linalg.solve(normal, rhs)*scale)
        rotation, translation = _pose_step(rotation=rotation, translation=translation, step=step)
        result[1:] += step[6:]
        if not np.isfinite(result).all() or np.abs(result).max() > 100:
            raise ValueError('fitting coefficients exceed the bounded profile')
    final_pose = F(np.r_[_rotation_vector(matrix=rotation), translation]).astype(np.float64)
    if not np.isfinite(final_pose).all() or final_pose[5] >= -1:
        raise ValueError('invalid fitted camera pose')
    return result, final_pose, history
