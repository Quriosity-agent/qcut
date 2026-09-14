#!/bin/zsh
# Observe Jianying while the user runs 智能镜头分割 once: model files opened,
# CPU of the main/helper processes, network bytes, new CoreML/Algorithm caches.
S="${JY_SHOT_SPLIT_OUT:-$HOME/Desktop/code/qcut/qcut/.local/jianying-shot-split}"; mkdir -p "$S"
OUT=$S/watch-$(date +%H%M%S).log; DUR=${1:-90}
PIDS=$(pgrep -f "VideoFusion-macOS" | tr '\n' ',' ); PIDS=${PIDS%,}
CACHE="$HOME/Library/Containers/com.lemon.lvpro/Data/Library/Caches/com.lemon.lvpro/bach_private_cache"
ALGO="$HOME/Movies/JianyingPro/User Data/Cache/AlgorithmCache"
before_coreml=$(ls "$CACHE" | grep -c coremlModels); before_algo=$(ls "$ALGO" | wc -l | tr -d ' ')
echo "watching pids $PIDS for ${DUR}s; coreml dirs=$before_coreml algo dirs=$before_algo" | tee "$OUT"
nettop -P -x -L 1 -t external 2>/dev/null | grep -i "VideoFusion" | awk '{print "net-before", $1, $5, $6}' | tee -a "$OUT"
END=$((SECONDS+DUR))
while [ $SECONDS -lt $END ]; do
  ts=$(date +%H:%M:%S.%N | cut -c1-12)
  lsof -nP -p "$PIDS" 2>/dev/null | grep -iE "ShotDetect|coremlModels|bytenn|\.model$|\.mlmodelc|AlgorithmCache" | awk -v t=$ts '{print t, "open:", $1, $NF}' | sort -u >> "$OUT"
  ps -o pid=,%cpu=,comm= -p "$PIDS" 2>/dev/null | awk -v t=$ts '$2>30 {print t, "cpu:", $1, $2, $3}' >> "$OUT"
  sleep 0.5
done
nettop -P -x -L 1 -t external 2>/dev/null | grep -i "VideoFusion" | awk '{print "net-after", $1, $5, $6}' | tee -a "$OUT"
echo "new coreml dirs: $(( $(ls "$CACHE" | grep -c coremlModels) - before_coreml )); new algo dirs: $(( $(ls "$ALGO" | wc -l | tr -d ' ') - before_algo ))" | tee -a "$OUT"
ls -t "$CACHE" | head -3 | tee -a "$OUT"
echo "--- summary of opened model/cache files:"; grep "open:" "$OUT" | awk '{print $4}' | sort | uniq -c | sort -rn | head -12
echo "--- cpu peaks:"; grep "cpu:" "$OUT" | sort -k4 -rn | head -5
echo "log: $OUT"
