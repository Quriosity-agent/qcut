"""Full synthetic slot schedule through the mesh/matrix adapter."""
import struct
import unittest
from unittest import mock

import face_live_mesh_trace as mesh_trace
import face_live_mesh_matrix_trace_test as fixtures
from face_live_mesh_abi import COPY_RETURNS, SITES as MESH_SITES
from face_live_mesh_matrix_abi import SITES as MATRIX_SITES
from face_live_mesh_matrix_bridge import MeshMatrixTrace


class MeshMatrixBridgeTests(unittest.TestCase):
    make_controller = fixtures.MatrixTraceTests.make_controller

    def setUp(self):
        fixtures.MatrixTraceTests.setUp(self)
        self.points[:] = self.points[:3]
        self.mesh_patch = mock.patch.multiple(mesh_trace, verify_library=mock.Mock(return_value={}),
            command=self.commands, register=mock.Mock(side_effect=lambda **kw: self.registers[kw["name"]]))
        self.mesh_patch.start()
        self.addCleanup(self.mesh_patch.stop)
        self.bridge = MeshMatrixTrace(target=self.target, core="/pinned/core", agfx="/pinned/agfx",
                                      callback="parent.on_mesh", matrix_callback="parent.on_matrix")
        self.controller = self.bridge.matrix
        self.pc.GetModule.side_effect = lambda: self.modules[self.site()[0]]
        self.pc.GetFileAddress.side_effect = lambda: self.site()[1]
        self.pc.GetLoadAddress.side_effect = lambda _: self.site()[1] + getattr(self.memory.scope, self.site()[0] + "_slide")
        self.thread.GetProcess.return_value.GetTarget.return_value = self.target
        caller = self.thread.GetFrameAtIndex.return_value.GetPCAddress.return_value
        caller.GetFileAddress.side_effect = lambda: (0xC1F6C8 if self.bridge.mode == "getter" else
            0x5183DC if self.memory.branch == "update" else 0x5184E0)
        self.location.GetBreakpoint.side_effect = lambda: (
            self.bridge.points[self.bridge.mode] if self.bridge.mode != "disabled"
            else self.controller.points[self.controller.mode])

    def site(self):
        if self.bridge.mode != "disabled":
            return "core", MESH_SITES[self.bridge.mode]
        return MATRIX_SITES[self.controller.mode]

    def mesh_invoke(self):
        mode = self.bridge.mode
        if mode == "getter":
            self.memory.put(address=0xA000, data=struct.pack("<Q", self.memory.mesh))
            self.registers = dict(x0=self.memory.mesh, x9=0xA000, x10=8, w19=0, x20=0xB000)
        else:
            source, self.registers, _ = self.memory.copied(channel=mode)
            if mode == "normals":
                destination = 0x40000 + 20
                for index in range(source.normals.count):
                    self.memory.put(address=destination + index * 32,
                                    data=source.normals.data[index * 12:index * 12 + 12])
                self.memory.put(address=self.registers["sp"], data=struct.pack("<Qi", destination, 32))
                self.registers["x10"] = destination + source.normals.count * 32
            self.registers["x30"] = self.memory.slide + COPY_RETURNS[mode]
        row = self.bridge.observe(frame=self.frame, location=self.location, prediction=1,
                                 timestamp_us=0, face_id=self.memory.face_id, read=self.memory.read)
        self.memory.audit = self.controller.audit
        return row

    def matrix_invoke(self):
        self.registers = self.memory.registers()
        return self.bridge.observe_matrix(frame=self.frame, location=self.location,
                                         prediction=1, timestamp_us=0, face_id=self.memory.face_id)

    def getter(self):
        self.bridge.SetEnabled(True)
        self.mesh_invoke()

    def assert_all_diagnostics_disabled(self):
        self.assertTrue(all(not point.IsEnabled() for point in self.points[3:]))

    def test_exact_getter_copy_setter_schedule_uses_single_shared_slot(self):
        for branch in ("update", "create"):
            with self.subTest(branch=branch):
                self.memory.branch = branch
                self.getter()
                self.assertEqual(self.bridge.mode, "disabled")
                self.assertEqual(self.controller.mode, "mvp_getter")
                self.matrix_invoke()
                self.assertEqual(self.controller.mode, "mvp_saved")
                self.matrix_invoke()
                self.assertEqual(self.controller.mode, "model_getter")
                self.matrix_invoke()
                self.assertEqual(self.controller.mode, "model_saved")
                self.matrix_invoke()
                self.assertEqual(self.bridge.mode, "vertices")
                self.assertEqual(self.controller.mode, "mesh_copies")
                self.mesh_invoke()
                self.assertEqual(self.bridge.mode, "normals")
                self.mesh_invoke()
                self.assertEqual(self.bridge.mode, "disabled")
                self.assertIsNone(self.bridge.pending)
                self.assertEqual(self.controller.mode, "renderer_enter")
                self.assertFalse(self.bridge.report()["complete"])
                self.assertTrue(self.bridge.report()["mesh_copies_complete"])
                for _ in range(14):
                    self.matrix_invoke()
                self.assertTrue(self.bridge.report()["complete"])
                self.assertTrue(self.bridge.report()["matrix_trace"]["matrix_cpu_consumer_verified"])
                self.assertFalse(self.bridge.report()["matrix_consumer_verified"])
                self.assertFalse(self.bridge.report()["qcut_mesh_ownership_verified"])
                self.assertFalse(self.bridge.report()["gpu_consumption_verified"])
                self.assert_all_diagnostics_disabled()
                self.assertLessEqual(max(self.active_history), 4)

    def test_matrix_error_disables_both_controllers(self):
        self.getter()
        self.pc.GetFileAddress.side_effect = lambda: 0
        with self.assertRaisesRegex(ValueError, "unverified"):
            self.matrix_invoke()
        self.assertTrue(self.bridge.failed)
        self.assertFalse(self.bridge.report()["complete"])
        self.assert_all_diagnostics_disabled()

    def test_mesh_error_does_not_leave_matrix_slot_armed(self):
        self.getter()
        self.matrix_invoke()
        self.matrix_invoke()
        self.matrix_invoke()
        self.matrix_invoke()
        self.pc.GetFileAddress.side_effect = lambda: 0
        with self.assertRaisesRegex(ValueError, "unverified"):
            self.mesh_invoke()
        self.assertTrue(self.bridge.failed)
        self.assert_all_diagnostics_disabled()

    def test_matrix_callback_during_mesh_phase_fails_and_disables(self):
        self.getter()
        self.matrix_invoke()
        self.matrix_invoke()
        self.matrix_invoke()
        self.matrix_invoke()
        with self.assertRaisesRegex(ValueError, "mesh slot still active"):
            self.bridge.observe_matrix(frame=self.frame, location=self.location,
                                       prediction=1, timestamp_us=0, face_id=self.memory.face_id)
        self.assert_all_diagnostics_disabled()


if __name__ == "__main__":
    unittest.main()
