#!/bin/bash
while true; do
    status=$(git status --porcelain)
    if [ -n "$status" ]; then
        git add -A
        files=$(git diff --cached --name-only | wc -l)
        msg="chore: update $files file(s)"
        git commit -m "$msg"
        git push origin HEAD
        echo "[$(date '+%H:%M:%S')] Committed and pushed: $msg"
    else
        echo "[$(date '+%H:%M:%S')] No changes detected"
    fi
    sleep 120
done
