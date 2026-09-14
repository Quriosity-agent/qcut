#!/usr/bin/env bash
# Compile shot-split-bridge.mm against the private runtime snapshot (rpath → its Frameworks).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RT="${JY_SHOT_SPLIT_RUNTIME:-$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current}"
OUT="${JY_SHOT_SPLIT_OUT:-$HERE/../../.local/jianying-shot-split}"
mkdir -p "$OUT/build"
clang++ -std=c++17 -ObjC++ -O1 -g -fobjc-arc -framework Foundation -Wl,-rpath,"$RT/Frameworks" -o "$OUT/build/shot-split-bridge" "$HERE/shot-split-bridge.mm"
echo "built $OUT/build/shot-split-bridge"
# 研究工具:ByteNN 接口探针与结构/权重导出
for tool in bytenn-probe weight-dump feature-dump; do
  [ -f "$HERE/$tool.mm" ] || continue
  clang++ -std=c++17 -ObjC++ -O1 -g -fobjc-arc -framework Foundation -Wl,-rpath,"$RT/Frameworks" -o "$OUT/build/$tool" "$HERE/$tool.mm"
  echo "built $OUT/build/$tool"
done
