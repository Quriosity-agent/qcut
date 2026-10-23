"""Resident capability validation; no image requests or inference state are accepted."""
import argparse
from contextlib import redirect_stdout
import json
from pathlib import Path
import re
import sys

from body_coreml_assets import digest
from body_coreml_capability import inspect_capability
from body_skeleton_model import ASSET

MAX_REQUEST_BYTES = 8192
MAX_ERROR_CHARACTERS = 2048


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate capability request field')
        result[key] = value
    return result


def validate_request(*, line):
    if len(line) > MAX_REQUEST_BYTES or not line.endswith(b'\n'):
        raise ValueError('capability request exceeds its complete JSONL line budget')
    request = json.loads(line, object_pairs_hook=unique_object)
    if not isinstance(request, dict) or set(request) != {'id', 'report'}:
        raise ValueError('capability request requires only id and report')
    if not isinstance(request['id'], str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', request['id']):
        raise ValueError('invalid capability request identity')
    report = request['report']
    if not isinstance(report, str) or len(report) > 4096 or not Path(report).is_absolute():
        raise ValueError('absolute bounded capability report path required')
    return request


def serve(*, runtime, input_stream, output_stream, inspect=inspect_capability):
    runtime = Path(runtime).resolve(strict=True)
    while True:
        line = input_stream.readline(MAX_REQUEST_BYTES + 1)
        if not line:
            return
        request = {}
        try:
            request = validate_request(line=line)
            with redirect_stdout(sys.stderr):
                receipt = inspect(runtime=runtime)
                cpu = receipt['identity']['execution']['networks']['cpu']
                # The loader's process cache uses stat metadata; the capability must bind actual bytes.
                if cpu['asset'] != ASSET or cpu['assetSha256'] != digest(path=runtime / 'research' / ASSET):
                    raise ValueError('body capability CPU asset changed during validation')
                Path(request['report']).write_text(json.dumps(
                    receipt, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n')
            response = {'id': request['id'], 'ok': True}
        except (Exception, SystemExit) as error:
            response = {'id': request.get('id', ''), 'ok': False,
                        'error': f'{type(error).__name__}: {error}'[:MAX_ERROR_CHARACTERS]}
        output_stream.write(json.dumps(response, ensure_ascii=True, allow_nan=False) + '\n')
        output_stream.flush()
        if not response['ok']:
            return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    args = parser.parse_args()
    serve(runtime=args.runtime, input_stream=sys.stdin.buffer, output_stream=sys.stdout)


if __name__ == '__main__':
    main()
