#!/bin/zsh
# Observe 剪映 while the user runs 智能镜头分割 once: transient model/cache file opens,
# CPU of every VideoFusion/VEHelper process (re-resolved each poll so freshly spawned
# helpers are included), network bytes, draft/cache directory changes.
# Usage: watch-shot-split.sh [seconds]   (output dir: $JY_SHOT_SPLIT_OUT)
S="${JY_SHOT_SPLIT_OUT:-$HOME/Desktop/code/qcut/qcut/.local/jianying-shot-split}"; mkdir -p "$S"
OUT=$S/watch-$(date +%H%M%S).log; DUR=${1:-300}
CACHE="$HOME/Library/Containers/com.lemon.lvpro/Data/Library/Caches/com.lemon.lvpro/bach_private_cache"
ALGO="$HOME/Movies/JianyingPro/User Data/Cache/AlgorithmCache"
DRAFTS="$HOME/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
pids() { pgrep -f "VideoFusion-macOS|VEHelper|lvve" | tr '\n' ',' | sed 's/,$//'; }
before_coreml=$(ls "$CACHE" | grep -c coremlModels); before_algo=$(ls "$ALGO" | wc -l | tr -d ' ')
before_draft=$(ls -t "$DRAFTS" | head -1); before_draft_mtime=$(stat -f %m "$DRAFTS/$before_draft")
echo "watching for ${DUR}s from $(date +%H:%M:%S); pids $(pids); coreml dirs=$before_coreml algo dirs=$before_algo newest draft=$before_draft" | tee "$OUT"
nettop -P -x -L 1 -t external 2>/dev/null | grep -i "VideoFusion" | awk -F, '{print "net-before", $2, "in", $5, "out", $6}' | tee -a "$OUT"
END=$((SECONDS+DUR)); n=0
while [ $SECONDS -lt $END ]; do
  ts=$(date +%H:%M:%S.%N | cut -c1-12); P=$(pids); n=$((n+1))
  lsof -nP -p "$P" 2>/dev/null | grep -iE "ShotDetect|coremlModels|bytenn|\.model$|\.mlmodelc|AlgorithmCache|SceneEditDetection|\.bytenn" | awk -v t=$ts '{print t, "open:", $1, $2, $NF}' | sort -u >> "$OUT"
  ps -o pid=,%cpu=,comm= -p "$P" 2>/dev/null | awk -v t=$ts '$2>15 {print t, "cpu:", $1, $2, $3}' >> "$OUT"
  if [ $((n % 10)) -eq 0 ]; then
    now_mtime=$(stat -f %m "$DRAFTS/$(ls -t "$DRAFTS" | head -1)"); [ "$now_mtime" != "$before_draft_mtime" ] && { echo "$ts draft-changed: $(ls -t "$DRAFTS" | head -1)" >> "$OUT"; before_draft_mtime=$now_mtime; }
    for d in "$CACHE" "$ALGO"; do ls -t "$d" | head -2 | while read f; do age=$(( $(date +%s) - $(stat -f %m "$d/$f") )); [ $age -lt 6 ] && echo "$ts cache-touched: $d/$f" >> "$OUT"; done; done
  fi
  sleep 0.2
done
nettop -P -x -L 1 -t external 2>/dev/null | grep -i "VideoFusion" | awk -F, '{print "net-after", $2, "in", $5, "out", $6}' | tee -a "$OUT"
echo "new coreml dirs: $(( $(ls "$CACHE" | grep -c coremlModels) - before_coreml )); new algo dirs: $(( $(ls "$ALGO" | wc -l | tr -d ' ') - before_algo ))" | tee -a "$OUT"
echo "--- transient file opens (seen in fewer than all $n polls):"; grep "open:" "$OUT" | awk '{print $4, $5}' | sort | uniq -c | awk -v n=$n '$1 < n' | sort -rn | head -15
echo "--- cpu peaks (>15%):"; grep "cpu:" "$OUT" | sort -k4 -rn | head -8
echo "--- draft / cache events:"; grep -E "draft-changed|cache-touched" "$OUT" | head -10
echo "polls: $n  log: $OUT"
