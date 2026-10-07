"""Owned still-photo 248-point 2D makeup placement from ordinary Extra240."""
import numpy as np

F = np.float32


def points_array(*, value, count):
    if (not isinstance(value, np.ndarray) or value.dtype != np.float32
            or value.shape != (count, 2) or not np.isfinite(value).all()
            or np.max(np.abs(value)) > 32768):
        raise ValueError('bounded float32 makeup landmarks required')
    return value


def spline(*, points, counts):
    points_array(value=points, count=len(points))
    counts = np.asarray(counts)
    if (not 3 <= len(points) <= 106 or counts.shape != (len(points)-1,)
            or counts.dtype.kind not in 'iu' or np.any(counts < 1)
            or np.any(counts > 16) or counts.sum() > 512):
        raise ValueError('bounded spline subdivision counts required')
    padded = np.vstack((points[0]-(points[1]-points[0]), points,
                        points[-1]-(points[-2]-points[-1])))
    output = []
    for segment, count in enumerate(counts):
        control = padded[segment:segment+4]
        delta = control[1:]-control[:-1]
        knots = np.r_[F(0), np.cumsum(np.sqrt(delta[:, 0]*delta[:, 0]+delta[:, 1]*delta[:, 1]), dtype=np.float32)]
        if np.any(np.diff(knots) == 0):
            raise ValueError('coincident spline controls require a separate native profile')
        output.append(control[1].copy())
        for step in range(1, int(count)):
            t = knots[1]+((knots[2]-knots[1])*F(step))/F(count)
            a = [(control[i]*(knots[i+1]-t))/(knots[i+1]-knots[i])
                 + ((t-knots[i])*control[i+1])/(knots[i+1]-knots[i]) for i in range(3)]
            b = [((knots[i+2]-t)*a[i])/(knots[i+2]-knots[i])
                 + ((t-knots[i])*a[i+1])/(knots[i+2]-knots[i]) for i in range(2)]
            output.append(((knots[2]-t)*b[0])/(knots[2]-knots[1])
                          + ((t-knots[1])*b[1])/(knots[2]-knots[1]))
    output.append(points[-1].copy())
    return np.asarray(output, np.float32)


def mouth64(*, primary, assets):
    points_array(value=primary, count=106)
    upper = spline(points=primary[84:91], counts=assets['mouth_upper_counts'])
    inner_upper = spline(points=primary[96:101], counts=np.full(4, 4, np.int32))
    inner_lower = spline(points=primary[[96, 103, 102, 101, 100]], counts=np.full(4, 4, np.int32))
    lower = spline(points=primary[[84, 95, 94, 93, 92, 91, 90]], counts=assets['mouth_lower_counts'])
    raw = np.vstack((upper[1:-1], inner_upper[1:-1], inner_lower[1:-1], lower[3:-3:3],
                     upper[[0, -1]], inner_upper[[0, -1]]))
    if raw.shape != (64, 2):
        raise ValueError('unexpected mouth conversion cardinality')
    result = raw[assets['mouth_order']].copy()
    result[:, 1] = (result[:, 1].astype(np.float64)*float(assets['mouth_y_scale'][0])).astype(np.float32)
    return result


def original_pixels(*, points, algorithm_size, image_size):
    points_array(value=points, count=240)
    for size in (algorithm_size, image_size):
        if not isinstance(size, (tuple, list)) or len(size) != 2 or any(type(v) is not int or not 1 <= v <= 4096 for v in size):
            raise ValueError('bounded makeup image dimensions required')
    width, height = algorithm_size
    target_width, target_height = image_size
    result = np.empty_like(points)
    result[:, 0] = (points[:, 0]*F(1/width))*F(target_width)
    result[:, 1] = F(target_height)-((F(height)-points[:, 1])*F(1/height))*F(target_height)
    return result


def working_mesh(*, points, assets):
    points_array(value=points, count=240)
    primary = points[:106]
    center = primary[46]
    radial = center+(primary[assets['radial_indices']]-center)*np.array([2]*7+[3], np.float32)[:, None]
    left_eye = points[np.r_[217:206:-1, 196:207]]
    right_eye = points[np.r_[239:228:-1, 218:229]]
    return np.vstack((primary, radial, points[170:196], left_eye, right_eye,
                      mouth64(primary=primary, assets=assets))).astype(np.float32)
