"""Locked align-160 terminal schema and pre-existing operator parity gates."""
HEAD_CHANNELS = {"fc_landmark_s1": 212, "fc_visible": 106, "prob": 5, "fc_yaw": 1, "fc_pitch": 1}
MODEL_SHA256 = "45e3499295914247ab3a74fc080cf82c9cdecc82592224580a775838a5410174"
GATES = {"fc_landmark_s1": (0.0001, 0.00001, None),
         "fc_visible": (0.000001, 0.00001, 0.001),
         "prob": (0.000001, 0.00001, 0.001),
         "fc_yaw": (0.0001, 0.00001, None),
         "fc_pitch": (0.0001, 0.00001, None)}
