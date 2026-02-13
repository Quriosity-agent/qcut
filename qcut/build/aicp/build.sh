#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
DIST_DIR="$SCRIPT_DIR/dist"
WORK_DIR="$SCRIPT_DIR/build-temp"

AICP_SOURCE_REPO="${AICP_SOURCE_REPO:-https://github.com/donghaozhang/video-agent-skill.git}"
AICP_SOURCE_REF="${AICP_SOURCE_REF:-v1.0.0}"
PYTHON_BIN="${AICP_PYTHON_BIN:-python3.12}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[build-aicp] Missing required interpreter: $PYTHON_BIN" >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip setuptools wheel
python -m pip install "git+$AICP_SOURCE_REPO@$AICP_SOURCE_REF"
python -m pip install pyinstaller

pyinstaller "$SCRIPT_DIR/aicp.spec" \
  --distpath "$DIST_DIR" \
  --workpath "$WORK_DIR" \
  --clean \
  -y

"$DIST_DIR/aicp" --version

echo "[build-aicp] Built binary: $DIST_DIR/aicp"
