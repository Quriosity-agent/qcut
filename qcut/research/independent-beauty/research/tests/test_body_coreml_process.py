"""Resident protocol/lifetime tests use child processes, without private models."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_coreml_process import BodyCoreMLCancelled, BodyCoreMLError, BodyCoreMLNetwork
from body_coreml_assets import digest
from body_coreml_build import HOST_SOURCE

FAKE_HOST = r'''
import base64,json,struct,sys,time
network,mode = sys.argv[1:]
def send(value):
    print(json.dumps(value), flush=True)
if mode == 'init-hang': time.sleep(60)
if mode == 'init-crash': sys.exit(19)
if mode in ('init-fatal','init-integrity'):
    send({'type':'fatal','error':'model load failed','errorKind':'integrity' if mode=='init-integrity' else 'initialization'})
    sys.exit(1)
ready = {'type':'ready','protocol':1,'network':network,
         'inputName':'input' if network == 'coarse' else 'x_1',
         'computeUnits':'All','loadedImages':[sys.executable,'/usr/lib/libSystem.B.dylib']}
if mode == 'foreign-image': ready['loadedImages'].append('/vendor/libprivate.dylib')
if mode == 'wrong-network': ready['network'] = 'unknown'
send(ready)
if mode == 'no-read': time.sleep(60)
for line in sys.stdin:
    request=json.loads(line)
    if mode == 'hang': time.sleep(60)
    if mode == 'crash': sys.exit(23)
    if mode == 'fatal':
        send({'type':'fatal','error':'prediction failed explicitly','errorKind':'runtime'})
        sys.exit(1)
    if mode == 'malformed':
        print('not json',flush=True)
        continue
    if mode == 'oversize':
        print('x'*(2*1024*1024+1),flush=True)
        continue
    channels={'heatmap_output_0':19,'vectormap_output_0':38} if network=='coarse' else {'output_0':34}
    h,w=request['shape'][1]//8,request['shape'][2]//8
    outputs={}
    for name,c in channels.items():
        value=float('nan') if mode=='nonfinite' else 1.25
        data=base64.b64encode(struct.pack('<f',value)*(h*w*c)).decode()
        outputs[name]={'shape':[1,h,w,c], 'data':data}
    if mode=='shape': outputs[next(iter(outputs))]['shape'][1]+=1
    if mode=='length': outputs[next(iter(outputs))]['data']='AA=='
    if mode=='names': outputs['unexpected']=outputs.pop(next(iter(outputs)))
    result={'type':'result','id':request['id'],'outputs':outputs,'systemLibrariesOnly':True}
    if mode=='request-id': result['id']+=1
    if mode=='libraries': result['systemLibrariesOnly']=False
    send(result)
'''


class ResidentCoreMLTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.fake = self.root / 'fake_host.py'
        self.fake.write_text(FAKE_HOST)
        self.networks, self.processes = [], []
        self.mode = 'success'
        self.prepare = patch('body_coreml_process.prepare_host', return_value={
            'binary': sys.executable, 'binarySha256': 'test', 'sourceSha256': digest(path=HOST_SOURCE)}).start()
        patch('body_coreml_process.verify_model', return_value={'validated': True}).start()
        patch('body_coreml_process._launch', side_effect=self.launch).start()

    def tearDown(self):
        for network in self.networks:
            network.close()
        for process in self.processes:
            self.assertIsNotNone(process.poll(), 'child process leaked after close')
        patch.stopall()
        self.temporary.cleanup()

    def launch(self, *, binary, model_directory, network):
        process = subprocess.Popen([sys.executable, str(self.fake), network, self.mode],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.processes.append(process)
        return process

    def make(self, *, network='refine', ready=True, **kwargs):
        value = BodyCoreMLNetwork(network=network, model_directory=self.root / network,
                                 cache_directory=self.root / 'cache', **kwargs)
        self.networks.append(value)
        if ready:
            value.start()
            value.wait_ready(timeout=3)
        return value

    def tensor(self, *, network=None):
        shape = (network.metadata['inputShapes'][0] if network else [1, 192, 144, 3])
        return np.zeros(shape, dtype=np.float32)

    def test_metadata_and_identity_are_available_without_launch_and_copied(self):
        network = self.make(network='coarse', ready=False)
        self.assertEqual(network.metadata['inputShapes'], [[1,224,128,3],[1,224,176,3],[1,128,224,3],[1,176,224,3]])
        self.assertEqual(network.status['state'], 'new')
        self.assertIsNone(network.status['errorKind'])
        changed = network.identity
        changed['sources'].clear()
        self.assertTrue(network.identity['sources'])
        network.metadata['inputShapes'].clear()
        self.assertEqual(len(network.metadata['inputShapes']), 4)
        self.assertFalse(self.processes)

    def test_same_process_serves_two_predictions_with_physical_float_values(self):
        network = self.make()
        first_pid = network.provenance['processId']
        for _ in range(2):
            result = network.infer(tensor=self.tensor())['output_0']
            self.assertEqual(result.dtype, np.float32)
            self.assertEqual(result.shape, (1,24,18,34))
            np.testing.assert_array_equal(result, np.full(result.shape, 1.25, dtype=np.float32))
        self.assertEqual(network.provenance['processId'], first_pid)
        self.assertEqual(len(self.processes), 1)
        self.assertEqual(network.start()['state'], 'ready')

    def test_coarse_all_shapes_and_named_outputs(self):
        network = self.make(network='coarse')
        for shape in network.metadata['inputShapes']:
            result = network.infer(tensor=np.zeros(shape, dtype=np.float32))
            self.assertEqual(set(result), {'heatmap_output_0','vectormap_output_0'})
            self.assertEqual(result['heatmap_output_0'].shape, (1,shape[1]//8,shape[2]//8,19))
            self.assertEqual(result['vectormap_output_0'].shape[-1], 38)

    def test_identity_excludes_paths_and_instance_generation(self):
        first, second = self.make(ready=False), self.make(ready=False)
        self.assertEqual(first.identity, second.identity)
        self.assertNotEqual(first.generation, second.generation)
        json.dumps(first.identity, allow_nan=False)

    def test_start_and_status_do_not_wait_for_initialization(self):
        self.mode = 'init-hang'
        network = self.make(ready=False, startup_timeout=3)
        began = time.monotonic()
        self.assertEqual(network.start()['state'], 'starting')
        for _ in range(20):
            self.assertFalse(network.status['ready'])
        self.assertLess(time.monotonic() - began, 0.5)
        with self.assertRaises(TimeoutError):
            network.wait_ready(timeout=0.05)
        self.assertEqual(network.status['state'], 'starting')

    def test_initialization_timeout_is_terminal(self):
        self.mode = 'init-hang'
        network = self.make(ready=False, startup_timeout=0.15)
        network.start()
        with self.assertRaisesRegex(BodyCoreMLError, 'initialization timed out'):
            network.wait_ready(timeout=3)
        self.assertEqual(network.start()['state'], 'failed')
        self.assertFalse(network.status['ready'])
        self.assertEqual(network.status['errorKind'], 'initialization')

    def test_initialization_crash_or_bad_identity_is_not_ready(self):
        for mode in ('init-crash','foreign-image','wrong-network','init-fatal','init-integrity'):
            with self.subTest(mode=mode):
                self.mode = mode
                network = self.make(ready=False)
                network.start()
                with self.assertRaises(BodyCoreMLError):
                    network.wait_ready(timeout=3)
                self.assertEqual(network.status['state'], 'failed')
                expected_kind = 'initialization' if mode in ('init-crash','init-fatal') else 'integrity'
                self.assertEqual(network.status['errorKind'], expected_kind)

    def test_prepare_error_is_visible_and_launch_is_skipped(self):
        self.prepare.side_effect = RuntimeError('compiler unavailable')
        network = self.make(ready=False)
        network.start()
        with self.assertRaisesRegex(BodyCoreMLError, 'compiler unavailable'):
            network.wait_ready(timeout=3)
        self.assertFalse(self.processes)
        self.assertEqual(network.status['errorKind'], 'initialization')

    def test_build_identity_mismatch_is_terminal_before_launch(self):
        self.prepare.return_value['sourceSha256'] = 'different'
        network = self.make(ready=False)
        network.start()
        with self.assertRaisesRegex(BodyCoreMLError, 'build source identity mismatch'):
            network.wait_ready(timeout=3)
        self.assertFalse(self.processes)
        self.assertEqual(network.status['errorKind'], 'integrity')

    def test_model_asset_failure_is_integrity_and_never_launches(self):
        with patch('body_coreml_process.verify_model', side_effect=ValueError('compiled model identity mismatch')):
            with self.assertRaisesRegex(BodyCoreMLError, 'identity mismatch') as caught:
                self.make(ready=False)
        self.assertEqual(caught.exception.error_kind, 'integrity')
        self.assertFalse(self.processes)

    def test_model_is_reverified_before_launch(self):
        network = self.make(ready=False)
        with patch('body_coreml_process.verify_model', side_effect=ValueError('model changed after construction')):
            network.start()
            with self.assertRaisesRegex(BodyCoreMLError, 'model changed'):
                network.wait_ready(timeout=3)
        self.assertEqual(network.status['errorKind'], 'integrity')
        self.assertFalse(self.processes)

    def test_source_mutation_is_integrity_before_model_verification(self):
        network = self.make(ready=False)
        with patch('body_coreml_process.digest', return_value='different'):
            network.start()
            with self.assertRaisesRegex(BodyCoreMLError, 'source changed'):
                network.wait_ready(timeout=3)
        self.assertEqual(network.status['errorKind'], 'integrity')
        self.assertFalse(self.processes)

    def test_close_before_start_is_terminal(self):
        network = self.make(ready=False)
        network.close()
        self.assertEqual(network.start()['state'], 'closed')
        self.assertFalse(self.processes)
        with self.assertRaises(BodyCoreMLError):
            network.infer(tensor=self.tensor())

    def test_late_created_child_after_close_is_terminated(self):
        entered, release = threading.Event(), threading.Event()
        def delayed_launch(**kwargs):
            entered.set()
            release.wait(timeout=3)
            return self.launch(**kwargs)
        with patch('body_coreml_process._launch', side_effect=delayed_launch):
            network = self.make(ready=False)
            network.start()
            self.assertTrue(entered.wait(timeout=3))
            network.close()
            release.set()
            network._worker.join(timeout=3)
            self.assertFalse(network._worker.is_alive())
            self.assertEqual(network.status['state'], 'closed')
            self.assertEqual(len(self.processes), 1)
            self.assertIsNotNone(self.processes[0].poll())

    def test_wait_cancellation_closes_loading_process(self):
        self.mode = 'init-hang'
        network = self.make(ready=False)
        network.start()
        with self.assertRaises(BodyCoreMLCancelled):
            network.wait_ready(timeout=3, cancelled=lambda: True)
        self.assertEqual(network.status['state'], 'closed')

    def test_invalid_inputs_leave_ready_process_usable(self):
        network = self.make()
        for value in (np.zeros((1,1,1,3), np.float32), self.tensor().astype(np.int16),
                      self.tensor().astype(np.float64), np.full(self.tensor().shape, np.nan, np.float32)):
            with self.assertRaises(ValueError):
                network.infer(tensor=value)
            self.assertEqual(network.status['state'], 'ready')
        network.infer(tensor=self.tensor())

    def test_prediction_failures_are_terminal_without_cpu_retry(self):
        for mode in ('crash','fatal','malformed','oversize','shape','length','names','request-id','nonfinite','libraries'):
            with self.subTest(mode=mode):
                self.mode = mode
                network = self.make()
                with self.assertRaises(BodyCoreMLError):
                    network.infer(tensor=self.tensor(), timeout=3)
                self.assertEqual(network.status['state'], 'failed')
                if mode in ('crash','fatal'):
                    self.assertEqual(network.status['errorKind'], 'runtime')
                with self.assertRaises(BodyCoreMLError):
                    network.infer(tensor=self.tensor())

    def test_prediction_timeout_kills_host_even_when_pipe_write_is_blocked(self):
        self.mode = 'no-read'
        network = self.make()
        with self.assertRaises(TimeoutError):
            network.infer(tensor=self.tensor(), timeout=0.1)
        self.assertEqual(network.status['state'], 'failed')
        self.assertIsNotNone(self.processes[-1].poll())
        self.assertEqual(network.status['errorKind'], 'runtime')

    def test_cancel_callback_interrupts_blocked_pipe_write(self):
        self.mode = 'no-read'
        network = self.make()
        began = time.monotonic()
        with self.assertRaises(BodyCoreMLCancelled):
            network.infer(tensor=self.tensor(), cancelled=lambda: time.monotonic() - began > 0.05)
        self.assertEqual(network.status['state'], 'closed')
        self.assertIsNotNone(self.processes[-1].poll())

    def test_callback_exception_terminates_pending_inference(self):
        self.mode = 'hang'
        network = self.make()
        def broken_callback():
            if network._pending is not None:
                raise RuntimeError('cancel source failed')
            return False
        with self.assertRaisesRegex(RuntimeError, 'cancel source failed'):
            network.infer(tensor=self.tensor(), cancelled=broken_callback)
        self.assertEqual(network.status['state'], 'failed')
        self.assertIsNotNone(self.processes[-1].poll())

    def test_cancel_inflight_and_reject_concurrent_inference(self):
        self.mode = 'hang'
        network = self.make()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            first = pool.submit(network.infer, tensor=self.tensor())
            deadline = time.monotonic() + 3
            while network._pending is None and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertIsNotNone(network._pending)
            with self.assertRaisesRegex(BodyCoreMLError, 'in flight'):
                network.infer(tensor=self.tensor())
            network.cancel()
            with self.assertRaises(BodyCoreMLCancelled):
                first.result(timeout=3)
        self.assertEqual(network.status['state'], 'closed')

    def test_invalid_timeout_and_network_rejected(self):
        for timeout in (0,-1,True,float('inf'),float('nan')):
            with self.assertRaises(ValueError):
                self.make(ready=False, startup_timeout=timeout)
        with self.assertRaises(ValueError):
            self.make(network='unknown', ready=False)


if __name__ == '__main__':
    unittest.main()
