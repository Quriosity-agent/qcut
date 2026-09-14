#!/usr/bin/env bash
# Regenerate the symbol evidence from the private runtime snapshot (not from the app):
# exports, the shot-detect strings, the Bach system vtable and the annotated
# disassembly of TEBachVideoAutoSplit. Output goes to .local/jianying-shot-split/ (git-ignored).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="${JY_SHOT_SPLIT_RUNTIME:-$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current}"
OUT="${JY_SHOT_SPLIT_OUT:-$HERE/../../.local/jianying-shot-split}"
mkdir -p "$OUT"; cd "$OUT"
LIB=libcccreator-arm64.dylib
[[ -f "$LIB" ]] || lipo -thin arm64 -output "$LIB" "$RUNTIME/Frameworks/libcccreator.dylib"
nm -n -gU "$LIB" | awk '{print $1, $3}' > exports.sorted
strings -n 5 "$LIB" > libcccreator.strings
grep -n -iE "compress_shot_detect|compressShotDetect|COMPRESS_SHOT_DETECT|VideoAutoSplit|videoAutoSplit|CutPointDetection|frame_received|predict_result|bef_bach_get_graph|bef_bach_resource_finder" libcccreator.strings \
  | grep -viE "^\S*:_?Z|^\S*:N[0-9]|^\S*:NS" > shot-detect.strings || true
echo "exports: $(wc -l < exports.sorted)  strings: $(wc -l < libcccreator.strings)  shot-detect strings: $(wc -l < shot-detect.strings)"
sym() { grep " $1\$" exports.sorted | awk '{print $1}'; }
next_after() { awk -v a="$1" '$1 > a {print $1; exit}' exports.sorted; }
range() { local a; a=$(sym "$1"); [[ -n "$a" ]] || { echo "missing $1" >&2; return 1; }; echo "0x$a 0x$(next_after "$a")"; }
# name + mangled symbol pairs (plain list: macOS ships bash 3.2, no associative arrays)
FUNCS="initBachSystem __ZN20TEBachVideoAutoSplit14initBachSystemER20TEBachAlgorithmParamNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEE
executeFrame __ZN20TEBachVideoAutoSplit12executeFrameENSt3__110shared_ptrI13ITEVideoFrameEE
processFrame __ZN20TEBachVideoAutoSplit12processFrameEPNSt3__110shared_ptrI13ITEVideoFrameEEj
getBachResult __ZN20TEBachVideoAutoSplit13getBachResultEPN4Bach19BachAlgorithmSystemEb
bef_bach_get_graph _bef_bach_get_graph
bef_bach_resource_finder_create _bef_bach_resource_finder_create"
while read -r name symbol; do
  [[ -n "$name" ]] || continue
  read -r a b < <(range "$symbol") || continue
  python3 "$HERE/tools/disasm.py" "$LIB" "$a" "$b" exports.sorted > "disasm-$name.txt"
  echo "disasm-$name.txt: $(wc -l < "disasm-$name.txt") insns, $(grep -c '; str "' "disasm-$name.txt") string refs"
done <<< "$FUNCS"
VT=$(sym "__ZTVN4Bach21BachAlgorithmSystemGEE"); python3 "$HERE/tools/vtable.py" "$LIB" "0x$VT" 34 exports.sorted > vtable-BachAlgorithmSystemGE.txt
echo "vtable-BachAlgorithmSystemGE.txt: $(grep -c '^slot' vtable-BachAlgorithmSystemGE.txt) slots"
echo "output: $OUT"
