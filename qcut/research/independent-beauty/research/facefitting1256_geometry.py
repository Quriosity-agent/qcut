"""Dynamic contour supports and equal-weight triangle normals for classical fitting."""
import numpy as np

from facefitting_pose import rodrigues

F = np.float32


def mesh_normals(*, vertices, triangles):
    normal = np.cross(vertices[triangles[:, 1]]-vertices[triangles[:, 0]],
                      vertices[triangles[:, 2]]-vertices[triangles[:, 0]])
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), F(1e-12))
    result = np.zeros_like(vertices)
    for corner in range(3):
        np.add.at(result, triangles[:, corner], normal)
    return result/np.maximum(np.linalg.norm(result, axis=1, keepdims=True), F(1e-12))


def contour_basis(*, basis, row):
    indices, weights = row[:3].astype(np.int32), row[3:]
    value = F(basis[:, indices[0]]*weights[0])
    value = F(value.astype(np.float64)+basis[:, indices[1]].astype(np.float64)*float(weights[1]))
    return F(value.astype(np.float64)+basis[:, indices[2]].astype(np.float64)*float(weights[2]))


def landmark_basis(*, model, coefficients, pose):
    basis = model['basis']
    vertices = F(coefficients@basis.reshape(70, -1)).reshape(1463, 3)
    normals = mesh_normals(vertices=vertices, triangles=model['triangles'])
    rotation = rodrigues(vector=pose[:3]).astype(F)
    direction = F(pose[3:]/np.sqrt(1e-8+pose[3:]@pose[3:]))
    result = basis[:, model['indices'][82:150]].copy()
    supports = []
    for index, candidates in enumerate(model['contours']):
        # Native tests every candidate with the first record's barycentric weights.
        test = ((normals[candidates[:, :3].astype(np.int32)]@rotation.T)
                * candidates[0, 3:][None, :, None]).sum(axis=1)@direction
        chosen = 1
        if index >= 17 or test[0] > 0:
            chosen = 2 if index >= 17 else 1
            while chosen < len(candidates)-1 and test[chosen] >= 0:
                chosen += 1
        supports.append(candidates[chosen])
    for index, row in enumerate(supports[::2]):
        result[:, 57+index] = contour_basis(basis=basis, row=row)
    return result
