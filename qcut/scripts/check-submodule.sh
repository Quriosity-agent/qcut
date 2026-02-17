#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

submodule_path="packages/video-agent-skill"
submodule_abs_path="${project_root}/${submodule_path}"
setup_py_path="${submodule_abs_path}/setup.py"

if [[ ! -f "${setup_py_path}" ]]; then
  echo "ERROR: video-agent-skill submodule is not initialized"
  echo "Run: git submodule update --init --recursive"
  exit 1
fi

if ! git -C "${project_root}" submodule status -- "${submodule_path}" >/dev/null 2>&1; then
  echo "ERROR: ${submodule_path} is not registered as a git submodule"
  echo "Verify .gitmodules and re-run: git submodule update --init --recursive"
  exit 1
fi

echo "Submodule OK: ${submodule_path}"
