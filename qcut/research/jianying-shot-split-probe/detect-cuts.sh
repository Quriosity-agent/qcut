#!/usr/bin/env bash
# Run 剪映's shot-boundary model on any video without the 剪映 app.
#   detect-cuts.sh <video> [fps=24] [width=320] [height=180]
# Prints JSON: {"fps":…, "frames":…, "cutFrames":[…], "cutPoints":[seconds…]}
# Needs: the private runtime snapshot (snapshot-private-runtime.sh) and a built bridge
# (build-bridge.sh). Frames are decoded with QCut's bundled ffmpeg; the blit node in the
# graph rescales to 96×96 anyway, so 320×180 input is plenty.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO="${1:?video path}"; FPS="${2:-24}"; W="${3:-320}"; H="${4:-180}"
RT="${JY_SHOT_SPLIT_RUNTIME:-$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current}"
OUT="${JY_SHOT_SPLIT_OUT:-$HERE/../../.local/jianying-shot-split}"
BRIDGE="$OUT/build/shot-split-bridge"
FFMPEG="${FFMPEG:-$HERE/../../electron/resources/ffmpeg/darwin-arm64/ffmpeg}"
[[ -x "$BRIDGE" ]] || { echo "bridge not built; run build-bridge.sh" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
"$FFMPEG" -v error -i "$VIDEO" -vf "fps=$FPS,scale=$W:$H" -pix_fmt rgba -f rawvideo "$TMP/frames.rgba"
LOG="$TMP/bridge.log"
"$BRIDGE" "$RT" VESDK "" "$RT/Resources/SceneEditDetection/config.json" "$TMP/frames.rgba" "$W" "$H" "$FPS" 0 1 > "$LOG" 2>&1 || { echo "bridge failed:" >&2; tail -20 "$LOG" >&2; exit 1; }
FRAMES=$(grep -oE "fed [0-9]+ frames" "$LOG" | grep -oE "[0-9]+")
CUTS=$(grep -E "^predict_result:" "$LOG" | sed 's/^predict_result: *//')
python3 - "$FPS" "$FRAMES" $CUTS <<'PY'
import json, sys
fps = float(sys.argv[1]); frames = int(sys.argv[2]); cuts = [int(x) for x in sys.argv[3:]]
# predict_result holds the last frame index of each shot; the next shot starts at index+1
print(json.dumps({"fps": fps, "frames": frames, "cutFrames": cuts, "cutPoints": [round((c + 1) / fps, 3) for c in cuts]}))
PY
