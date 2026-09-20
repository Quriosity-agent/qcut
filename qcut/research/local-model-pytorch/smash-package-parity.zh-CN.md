# SMASH 加密模型包：让厂商自己的读取器解包

日期：2026-09-20。分支：`codex/local-neural-model-tail-20260920`（PR #479）。
对象：`versioned-model-wrapper` 格式、载荷被 AES 加密、此前一直打不开的 SMASH 模型包。

## 结论

- 解包不需要复原密钥算法：`liblens.dylib` 导出了厂商自己的读取器 `smash::package::ModelPackage`
  （`InitFromBuf` / `Extract(record, map<string,string>)`），构造函数收一个**包密钥**，解密由运行库自己完成。
- 密钥按模型家族不同，不在库的字符串里。把 `ModelPackage` 的构造与 `Extract` 做 dyld interpose
  （`libcccreator` → `liblens` 是跨库调用，能拦到），在无头人像宿主里跑一次特效包，SDK 就会把它自己那把密钥交出来。
  本轮用改过 `algorithmConfig.json` 节点的本地特效包，额外触发了人脸校验与骨骼算法，共取得 3 把密钥。
- 由此打开 3 个包、恢复 5 张网络（其中 1 张与人体包里已恢复的同图），两个种子下**所有整数层与输出逐位一致**。
- 运行库语义新增一条：旧格式 7 字段 `Eltwise` 行没有 ReLU 标志，运行库**总是**施加 ReLU（探针 micro-el2）。
- 没有任何产品或编辑器接入。

## 网络清单

| id | 包 / 记录 | 头 | 层数 | arena 字节 | 输入 (h×w×c, [type, frac]) | 输出 | 两种子对拍（41/509） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aff60c469d265fa8` | tt_faceverify.verify | `B` | 77 | 4,333,820 | 112×112×3 `[2, 7]` | `fc1` | 整数层 89/89 逐位一致 |
| `43c68131874db50b` | tt_skeleton_v9.2.multi | `plain` | 96 | 140,476 | 224×224×3 `[1, 8]` | `stage1_L2` | 整数层 96/96 逐位一致 |
| `b29001c40732357e` | tt_skeleton_v9.2.single | `plain` | 106 | 241,176 | 192×144×3 `[1, 8]` | `stage1_L2` | 整数层 127/127 逐位一致 |
| `980877fab5b4e85e` | tt_skeletonlockon.multi | `plain` | 233 | 236,184 | 224×224×3 `[1, 6]` | `vectormap_output.0` | 整数层 239/239 逐位一致 |
| `615cd22f5bbe3fca` | tt_skeletonlockon.single | `plain` | 215 | 227,672 | 192×144×3 `[1, 6]` | `output.0` | 整数层 218/218 逐位一致 |

`tt_skeletonlockon/single` 与人体包里从堆中切出的 192×144 热图网络是同一张图（sha 相同），此处作为交叉验证保留。

## 仍然打不开

`tt_face_attribute_age/exp/extra`、`tt_face_extra_fast`、`tt_body_detection_lockon`、`tt_after_effect`、
`tt_matting_video_v1.2`：这三把密钥都不接受（`InitFromBuf` 返回 -4），缓存里也没有能触发对应算法的特效包。
人脸属性由 `face` 节点在开启 `face_attr_detect_ability` 时加载，但本轮改配置后 SDK 仍未请求这些模型，
说明还需要正确的能力位或节点类型。路线是清楚的：**让 SDK 自己加载一次，密钥就会被记录下来**。

## 安全边界

密钥属于厂商运行库，只保存在 `.local/jianying-model-pytorch/tail-20260920/package-keys.txt`（不进 Git，权限 600）。
提交的宿主 `smash_package_host.mm` 从 `QCUT_SMASH_PACKAGE_KEY` / `QCUT_SMASH_PACKAGE_KEYS` 读取，仓库里没有任何密钥。
解出的图与权重同样只在 `.local/`。

## 证据目录（全部在 `.local/`，不进 Git）

`tail-20260920/`：`pkgcap-sticker`、`pkgcap-attr2`（拦截日志与密钥）、`effect-attr`（本地特效包）、
`pkg/<模型>`（解出的 config/weight）、`collected-pkg/`（5 张网络 + `manifest.json`）、
`parity-pkg-r2`、`parity-pkg-seed509`、`micro-el`、`micro-el2`（探针图）。

## 复现

```sh
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
# 1. 观察 SDK 如何驱动读取器，取得该家族的包密钥
clang++ -std=c++17 -O1 -dynamiclib -fobjc-arc -framework Foundation -L"$R/Frameworks" -llens \
  -Wl,-rpath,"$R/Frameworks" research/local-model-pytorch/smash_package_capture.mm -o /tmp/pkgcap.dylib
env -i PATH="$PATH" HOME="$HOME" DYLD_LIBRARY_PATH="$R/Frameworks" DYLD_INSERT_LIBRARIES=/tmp/pkgcap.dylib \
  QCUT_SMASH_CAPTURE_DIR=<dir> QCUT_FRAME_WIDTH=1280 QCUT_FRAME_HEIGHT=720 \
  electron/resources/bin/jianying-portrait-adjustment-host "$R" "$R/Models" <effect-package> < commands.tsv
# 2. 用取得的密钥解包
clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation research/local-model-pytorch/smash_package_host.mm -o /tmp/pkg-host
QCUT_SMASH_PACKAGE_KEYS=<keys.txt> DYLD_LIBRARY_PATH="$R/Frameworks" /tmp/pkg-host "$R/Frameworks/liblens.dylib" <model> <outdir> <record...>
# 3. 收集并对拍
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_package_collect.py --package <outdir> --out <collected>
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_parity.py <collected>/*/ --out <parity> --seed 41
```
