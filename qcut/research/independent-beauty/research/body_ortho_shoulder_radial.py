"""One radial station of the shoulder displacement."""
import ctypes as C, numpy as np, math
F = np.float32

class Pair(C.Structure):
    _fields_ = [('x', C.c_float), ('y', C.c_float)]
_system = C.CDLL(None)
_system.__sincosf_stret.argtypes = [C.c_float]
_system.__sincosf_stret.restype = Pair

def norm(v):
    return F(np.sqrt(F(F(v[0] * v[0]) + F(v[1] * v[1]))))

def displace(point, center, vector, anchor, radius, strength, rotation=0):
    p, c, vec, a = [np.asarray(x, np.float32) for x in [point, center, vector, anchor]]
    r = F(norm(F(p - c)) / F(radius))
    if r > F(1):
        return np.zeros(2, np.float32)
    weight = F(math.sqrt(1.0 - float(F(r * r))))
    scaled = F(vec * weight)
    d = F(p - a)
    sc = _system.__sincosf_stret(float(F(F(rotation * 90) * F(math.pi / 180))))
    sine, cosine = (F(sc.x), F(sc.y))
    rotated = F([F(F(cosine * d[0]) - F(sine * d[1])), F(F(sine * d[0]) + F(cosine * d[1]))])
    den = F(norm(rotated) + F(1e-06))
    unit = F(F(rotated * F(strength)) / den)
    amplitude = F(norm(scaled) + F(1e-06))
    return F(amplitude * unit)
