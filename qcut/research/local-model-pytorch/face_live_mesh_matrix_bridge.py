"""Lend the fourth hardware slot between mesh copies and matrix consumers."""
from face_live_mesh_abi import require
from face_live_mesh_trace import MeshTrace
from face_live_mesh_matrix_trace import MatrixTrace


class MeshMatrixTrace(MeshTrace):
    def __init__(self, *, target, core, agfx, callback, matrix_callback):
        super().__init__(target=target, core=core, callback=callback)
        self.matrix = MatrixTrace(target=target, core=core, agfx=agfx, callback=matrix_callback)

    def observe(self, *, frame, location, prediction, timestamp_us, face_id, read):
        try:
            row = super().observe(frame=frame, location=location, prediction=prediction,
                timestamp_us=timestamp_us, face_id=face_id, read=read)
            if row["event"] == "native_mesh_getter":
                self.disable()
                self.matrix.start(source=self.pending, prediction=prediction, timestamp_us=timestamp_us,
                    face_id=face_id, thread=self.scope[2], core_slide=self.scope[3], read=read)
            elif row["channel"] == "normals":
                self.matrix.resume(vertices=self.events[-2], normals=row)
            return row
        except Exception:
            self.failed = True
            self.disable()
            self.matrix.disable()
            raise

    def observe_matrix(self, *, frame, location, prediction, timestamp_us, face_id):
        try:
            require(condition=self.mode == "disabled", message="mesh slot still active during matrix capture")
            row = self.matrix.observe(frame=frame, location=location, prediction=prediction,
                timestamp_us=timestamp_us, face_id=face_id)
            if self.matrix.mode == "mesh_copies":
                self.switch(mode="vertices")
            return row
        except Exception:
            self.failed = True
            self.disable()
            self.matrix.disable()
            raise

    def report(self):
        result, matrix = super().report(), self.matrix.report()
        result.update(mesh_copies_complete=result["complete"], matrix_trace=matrix,
                      complete=result["complete"] and matrix["complete"])
        return result
