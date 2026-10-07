"""Save fitted mesh geometry and a source-versus-reprojection diagnostic."""
import json

import numpy as np
from PIL import Image, ImageDraw


def export_geometry(*, model, result, directory, image):
    vertices = result['vertices'][:1613]
    with (directory / 'mesh.obj').open('x') as stream:
        for x, y, z in vertices:
            stream.write(f'v {x:.9g} {y:.9g} {z:.9g}\n')
        for u, v in model.uv:
            stream.write(f'vt {u:.9g} {v:.9g}\n')
        for triangle in model.triangles:
            stream.write('f ' + ' '.join(f'{int(index) + 1}/{int(index) + 1}' for index in triangle) + '\n')
    from facefitting_pose import project
    with Image.open(image) as source:
        canvas = source.convert('RGB')
    projected = project(vertices=vertices, pose=result['pose'], camera=result['camera'], height=canvas.height)['image_points']
    draw = ImageDraw.Draw(canvas)
    for triangle in model.triangles:
        points = [tuple(float(value) for value in projected[index]) for index in triangle]
        draw.line(points + points[:1], fill=(50, 240, 200), width=1)
    canvas.save(directory / 'mesh-overlay.png')
    coefficients = result['coefficients']
    record = {'vertex_count': 1613, 'fitted_landmark_count': 221, 'triangle_count': 3056,
              'neutral_coefficient': float(coefficients[0]), 'shape_coefficients': coefficients[1:31].tolist(),
              'expression_coefficients': dict(zip(model.expression_names[1:], coefficients[31:].tolist())),
              'pose_rodrigues_then_translation': result['pose'].tolist(), 'camera_focal_cx_cy': result['camera'].tolist(),
              'camera_calibrated': False, 'units': 'model-space-units',
              'loss_history': result['loss_history'], 'solver_iterations': result['iterations']}
    (directory / 'fitting-3d.json').write_text(json.dumps(record, indent=2, allow_nan=False))
