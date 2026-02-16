#!/usr/bin/env bash
set -euo pipefail

submodule_path="packages/video-agent-skill"
setup_py_path="${submodule_path}/setup.py"

if [[ ! -f "${setup_py_path}" ]]; then
  echo "ERROR: video-agent-skill submodule is not initialized"
  echo "Run: git submodule update --init --recursive"
  exit 1
fi

if ! git submodule status -- "${submodule_path}" >/dev/null 2>&1; then
  echo "ERROR: ${submodule_path} is not registered as a git submodule"
  echo "Verify .gitmodules and re-run: git submodule update --init --recursive"
  exit 1
fi

echo "Submodule OK: ${submodule_path}"
