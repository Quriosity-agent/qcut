# SMASH 加密模型包：让厂商自己的读取器解包

日期：2026-09-20。分支：`codex/local-neural-model-tail-20260920`（PR #479）。
对象：`versioned-model-wrapper` 格式、载荷被 AES 加密、此前一直打不开的 SMASH 模型包。

## 结论

- 解包不需要复原密钥算法：`liblens.dylib` 导出了厂商自己的读取器 `smash::package::ModelPackage`
  （`InitFromBuf` / `Extract(record, map<string,string>)`），构造函数收一个**包密钥**，解密由运行库自己完成。
- 密钥按模型家族不同，不在库的字符串里（48 位字母数字，`strings` 找不到，也不是"两半相加/异或"之类的简单混淆）。
  把 `ModelPackage` 的构造与 `Extract` 做 dyld interpose（`libcccreator` → `liblens` 是跨库调用，能拦到），
  在无头人像宿主里跑一次特效包，SDK 就会把它自己那把密钥交出来。改本地特效包的 `algorithmConfig.json` 节点
  （`face_verify`、`skeleton`、`matting`、`after_effect`、`expression_detect`、`object_detect` 等类型，
  以及 `face` 节点的 `face_attr_detect_ability`）可以触发更多家族，**共取得 7 把密钥**。
- 由此打开 6 个包、恢复 9 张网络（其中 1 张与人体包里已恢复的同图），两个种子下**所有整数层与输出逐位一致**，
  浮点层最大 `6e-7`；`tt_matting_video` 的 fp32 图 136 层误差为 0。
- 运行库语义新增一条：旧格式 7 字段 `Eltwise` 行没有 ReLU 标志，运行库**总是**施加 ReLU（探针 micro-el2）。
- 没有任何产品或编辑器接入。

## 网络清单

| id | 包 / 记录 | 头 | 层数 | arena 字节 | 输入 (h×w×c, [type, frac]) | 输出 | 两种子对拍（41/509） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aff60c469d265fa8` | tt_faceverify / verify | `B` | 77 | 4,333,820 | 112×112×3 `[2, 7]` | `fc1` | 整数层 89/89 逐位一致；浮点层 1 层最大 `0` |
| `43c68131874db50b` | tt_skeleton / multi | `plain` | 96 | 140,476 | 224×224×3 `[1, 8]` | `stage1_L2` | 整数层 96/96 逐位一致 |
| `b29001c40732357e` | tt_skeleton / single | `plain` | 106 | 241,176 | 192×144×3 `[1, 8]` | `stage1_L2` | 整数层 127/127 逐位一致 |
| `980877fab5b4e85e` | tt_skeletonlockon / multi | `plain` | 233 | 236,184 | 224×224×3 `[1, 6]` | `vectormap_output.0` | 整数层 239/239 逐位一致 |
| `615cd22f5bbe3fca` | tt_skeletonlockon / single（与人体包同图） | `plain` | 215 | 227,672 | 192×144×3 `[1, 6]` | `output.0` | 整数层 218/218 逐位一致 |
| `12347479a31093f4` | tt_after_effect / base | `plain` | 64 | 134,076 | 224×224×3 `[1, 6]` | `blur_prob` | 整数层 55/55 逐位一致；浮点层 9 层最大 `6e-07` |
| `7d4775cfb0dc4fe2` | tt_after_effect / meaningless | `plain` | 58 | 96,044 | 224×224×3 `[1, 6]` | `meaningless_prob` | 整数层 55/55 逐位一致；浮点层 3 层最大 `3e-07` |
| `49a65167cb18bc1f` | tt_after_effect / portrait | `B` | 111 | 1,858,552 | 224×224×3 `[2, 6]` | `output` | 整数层 107/107 逐位一致；浮点层 4 层最大 `4.8e-07` |
| `3541691d6ed8ef66` | tt_matting_video / video_v1（包内 BM v6，再由 ByteNN 自解） | `plain` | 136 | 2,824,620 | 288×288×3 `[4, 0]` | `nn_3` | 全部 136 层浮点，最大 `0` |

`tt_skeletonlockon/single` 与人体包里从堆中切出的 192×144 热图网络是同一张图（sha 相同），此处作为交叉验证保留。

## 仍然打不开，以及为什么

| 文件 | 状态 |
| --- | --- |
| `tt_face_attribute_age`、`tt_face_attribute_exp` | **已解包**，但图头是 `USTQ` / `F`（权重再压缩），本仓库的解释器还没有对应解码；运行库本身接受该图（`CreateNet` 返回 0，blob 形状可读），所以只差一个 arena 解码器就能对拍 |
| `tt_face_attribute_extra`、`tt_face_extra_fast` | 仍缺密钥：7 把都被拒；需要能触发这两个算法的节点配置 |
| `tt_body_detection_lockon` | **不是密钥问题**：SDK 自己加载它也失败（`algorithm type 18 ... failed: -4`），该包与当前 SDK 版本不匹配 |

## 安全边界

密钥属于厂商运行库，只保存在 `.local/jianying-model-pytorch/tail-20260920/package-keys.txt`（不进 Git，权限 600）。
提交的宿主 `smash_package_host.mm` 从 `QCUT_SMASH_PACKAGE_KEY` / `QCUT_SMASH_PACKAGE_KEYS` 读取，仓库里没有任何密钥。
解出的图与权重同样只在 `.local/`。

## 证据目录（全部在 `.local/`，不进 Git）

`tail-20260920/`：`pkgcap-sticker`、`pkgcap-attr2`、`pkgcap-more`、`pkgcap-attr3`（拦截日志与密钥）、`effect-attr*`、`effect-more`（本地特效包）、
`pkg/<模型>`（解出的 config/weight）、`collected-pkg/`（5 张网络 + `manifest.json`）、
`parity-pkg-r2`、`parity-ae-seed41`、`parity-mv-seed41`、`parity-pkg-final509`、`init-matting_video`、`micro-el`、`micro-el2`（探针图）。

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
