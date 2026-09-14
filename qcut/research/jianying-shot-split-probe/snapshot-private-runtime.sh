#!/usr/bin/env bash
# Snapshot everything 智能镜头分割 research needs out of the installed 剪映 app into
# QCut's private runtime store, so the analysis (and a future native bridge) no longer
# depends on the app staying installed or on its version.
#   ~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/
#     Frameworks/   23-library closure (same set the tracking research validated)
#     Resources/models/                jy_compressShotDetect{Backbone,PredHead}[_new]_v1.0_size0.bytenn
#     Resources/SceneEditDetection/    config.json, config_prev.json (the Bach graph configs)
#     manifest.json                    SHA-256 per file, app version + libcccreator UUID, localOnly
# Nothing here is copied into the repository. Refuses to run without the app.
set -euo pipefail
APP="${JY_APP_BUNDLE:-/Applications/VideoFusion-macOS.app}"
DEST="${JY_SHOT_SPLIT_RUNTIME:-$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current}"
FRAMEWORKS=(libAGFX.dylib libByteVC1_dec.dylib libEGL.dylib libGLESv2.dylib libIESAppLogger.dylib
  libLumiGeneRuntime.dylib libavcodec.dylib libavdevice.dylib libavfilter.dylib libavformat.dylib
  libavutil.dylib libbytenn.dylib libcccreator.dylib libdav1d.dylib libfastcv.dylib libffmpeg.dylib
  liblens.dylib libmp3lame.0.dylib libsamicore.dylib libsscronet.dylib libswresample.dylib
  libswscale.dylib libvecryptor.dylib)
MODELS=(jy_compressShotDetectBackbone_v1.0_size0.bytenn jy_compressShotDetectPredHead_v1.0_size0.bytenn
  jy_compressShotDetectBackbone_new_v1.0_size0.bytenn jy_compressShotDetectPredHead_new_v1.0_size0.bytenn)
CONFIGS=(config.json config_prev.json)
[[ -d "$APP" ]] || { echo "剪映 not found at $APP" >&2; exit 1; }
BUNDLE_ID=$(defaults read "$APP/Contents/Info.plist" CFBundleIdentifier)
[[ "$BUNDLE_ID" == "com.lemon.lvpro" ]] || { echo "unexpected bundle id $BUNDLE_ID" >&2; exit 1; }
VERSION=$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString)
mkdir -p "$DEST/Frameworks" "$DEST/Resources/models" "$DEST/Resources/SceneEditDetection"
copy() { # copy if missing or different
  local src="$1" dst="$2"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then echo "  = $(basename "$dst")"; else cp "$src" "$dst"; echo "  + $(basename "$dst")"; fi
}
echo "snapshot 剪映 $VERSION → $DEST"
for f in "${FRAMEWORKS[@]}"; do copy "$APP/Contents/Frameworks/$f" "$DEST/Frameworks/$f"; done
for f in "${MODELS[@]}"; do copy "$APP/Contents/Resources/models/$f" "$DEST/Resources/models/$f"; done
for f in "${CONFIGS[@]}"; do copy "$APP/Contents/Resources/SceneEditDetection/$f" "$DEST/Resources/SceneEditDetection/$f"; done
UUID=$(dwarfdump --uuid "$DEST/Frameworks/libcccreator.dylib" | awk '/arm64/ {print $2}')
python3 - "$DEST" "$VERSION" "$UUID" <<'PY'
import hashlib, json, os, sys, datetime
dest, version, uuid = sys.argv[1:4]
files = []
for root, _, names in os.walk(dest):
    for n in sorted(names):
        if n == "manifest.json": continue
        p = os.path.join(root, n); h = hashlib.sha256(open(p, "rb").read()).hexdigest()
        files.append({"path": os.path.relpath(p, dest), "sha256": h, "bytes": os.path.getsize(p)})
manifest = {"schemaVersion": 1, "purpose": "jianying-shot-split-research", "app": {"bundleId": "com.lemon.lvpro", "version": version},
  "core": {"library": "Frameworks/libcccreator.dylib", "arm64Uuid": uuid}, "architecture": "arm64", "localOnly": True, "cloudUpload": False,
  "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "files": files, "totalBytes": sum(f["bytes"] for f in files)}
json.dump(manifest, open(os.path.join(dest, "manifest.json"), "w"), indent=2)
print(f"manifest: {len(files)} files, {manifest['totalBytes']/1e6:.1f} MB, libcccreator arm64 UUID {uuid}")
PY
