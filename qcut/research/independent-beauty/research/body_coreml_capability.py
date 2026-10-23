"""Validate the opt-in body execution before an editor may reuse cached pixels."""
import argparse
import copy
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import os

from body_coreml_build import prepare_host
from body_swing_execution import SwingExecution


def inspect_capability(*, runtime):
    if platform.system() != 'Darwin':
        raise RuntimeError('Swing CoreML body video requires macOS')
    execution = SwingExecution(runtime=runtime, generation='capability-inspection')
    try:
        identity = copy.deepcopy(execution.identity)
        identity.pop('generation')
        host = prepare_host(cache_directory=Path(tempfile.gettempdir()) / f'qcut-body-coreml-{os.getuid()}',
                            cancelled=lambda: False, register_process=lambda process: None)
        for model in identity['networks']['coreml'].values():
            if model['sources']['body_coreml_host.mm'] != host['sourceSha256']:
                raise ValueError('CoreML capability helper source changed during validation')
        hardware = subprocess.run(['/usr/sbin/sysctl', '-n', 'hw.model'], check=True,
                                  capture_output=True, text=True, timeout=5).stdout.strip()
        if not hardware or len(hardware) > 256:
            raise ValueError('CoreML capability hardware identity is invalid')
        return {'schemaVersion': 1, 'profile': 'swing-coreml-v1', 'identity': {
            'execution': identity, 'helper': {key: host[key] for key in ('sourceSha256', 'binarySha256')},
            'python': sys.version, 'hardwareModel': hardware}}
    finally:
        execution.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = inspect_capability(runtime=args.runtime)
    args.output.write_text(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
