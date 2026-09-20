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
- 由此打开 6 个包、恢复 **12 张网络**（其中 1 张与人体包里已恢复的同图），两个种子下**所有整数层与输出逐位一致**，
  浮点层最大 `6e-7`；`tt_matting_video` 的 fp32 图最大 `2.0e-3`（两类 softmax 的硬件倒数估计，见下）。
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
| `3541691d6ed8ef66` | tt_matting_video / video_v1（包内 BM v6，ByteNN 自解） | `plain` | 136 | 2,824,620 | 288×288×3 `[4, 0]` | `nn_3` | 136 层浮点，最大 `0.002` |
| `6eedcffec09ea24d` | tt_face_attribute_age / agenet（`USTQ` 压缩权重） | `USTQ` | 103 | 412,352 | 224×224×3 `[2, 7]` | `prob_gender` | 整数层 98/98 逐位一致；浮点层 2 层最大 `0`；3 层原生自身溢出，无法比较 |
| `0a884817f4f59147` | tt_face_attribute_exp / expnet（`F` 压缩权重） | `F` | 102 | 600,432 | 256×256×3 `[2, 7]` | `predict_attractive` | 整数层 89/89 逐位一致；浮点层 10 层最大 `0`；3 层原生自身溢出，无法比较 |
| `d41f5fd3b0b89cc6` | tt_face_extra_fast / extra（face 算法路径，无需密钥） | `B` | 100 | 454,116 | 224×224×3 `[2, 6]` | `fc` | 整数层 107/107 逐位一致；浮点层 4 层最大 `4.8e-06` |

`tt_skeletonlockon/single` 与人体包里从堆中切出的 192×144 热图网络是同一张图（sha 相同），此处作为交叉验证保留。

## 压缩权重（`USTQ` / `F`）

人脸属性两个包的图带压缩标记行，打包的权重比图自身的字节核算小得多（`agenet` 144,510 对 412,352）。
运行库在 `CreateNet` 时把它展开，所以展开后的 arena 只存在于内存里：给捕获器加一个
`QCUT_BYTENN_SCAN_AFTER_CREATE=1` 的创建后堆扫描，展开的 arena 就落在图戳窗口里，
`espresso_package_collect.py --capture` 按核算长度取窗口后缀并交给运行库验证。去掉标记行后的图配上展开 arena，
两个种子下全部逐位一致。压缩格式本身没有被复原，也不需要复原。

## 仍然打不开，以及为什么

| 文件 | 状态 |
| --- | --- |
| `tt_face_extra_fast` | **已恢复**，而且根本不需要密钥：把 `face` 节点的 `face_extra_fast_model_name` 指向它并置 `face_fast_mode=1`，face 算法就会加载成功，图与 arena 由 ByteNN 捕获器从 espresso 路径直接取得（`face_extra_model_name` / `face_user_extra_model_name` / `face_extra_model_key` 三种写法分别是不触发或让宿主崩溃） |
| `tt_face_attribute_extra` | 仍缺密钥。属性算法（type 46）由 `bach_expression_detect` + `expression_detect` + `object_detect` 三个节点一起出现时才创建，但在这个 SDK 版本里它**只请求 age 一个模型**：`face_attr_detect_ability` 取 255 / 4080 / 65280 / 65535 结果一致，都只加载 `ttfaceattrmodel/tt_face_attribute_age_v2.0.model`。`tt_face_attribute_exp` 与 age 共用密钥所以顺带打开，`extra` 的持有者没有被触发 |
| `tt_body_detection_lockon` | **不是密钥问题**：SDK 自己加载它也失败（`algorithm type 18 ... failed: -4`），该包与当前 SDK 版本不匹配 |

## 两个需要说明的修正

- **对拍脚本原先把 NaN 当成通过**：`max_abs` 取到 NaN 时不会大于任何阈值。修正后非有限张量单列，
  并区分"只有我们这边非有限"（判失败）与"运行库自己就溢出"（判无法比较）。
- 按这个判据重跑，`tt_matting_video` 的第一版 arena 是**切错的**（9 层输出 NaN）。原因是运行库只校验
  arena 尾部的图戳，任何以相同四字节结尾、长度正确的内存都会被接受。改用同一次捕获里权重全为有限值的
  那个戳窗口后，136 层全部通过。切割脚本已加"浮点图权重必须有限"的判据，并在文档里写明：
  **运行库接受只是必要条件，真正的判据是逐层对拍。**
- `agenet`、`expnet`、`tt_matting_large` 的 dense/softmax 头在合成随机输入下**运行库自身**就溢出成 NaN/inf，
  这些层标为"无法比较"，需要真实前处理输入才能验证；它们的整数层仍然逐位一致。

## ONNX 导出

只有浮点图可以如实导出：定点网络依赖舍入、int32 回绕与单边 lane 钳制，标准 ONNX 算子表达不了，
导成浮点近似就不是运行库在跑的那张网络。已导出并用 onnxruntime 回比**冻结的原生输出**：

| 网络 | ONNX vs PyTorch | ONNX vs 原生 |
| --- | --- | --- |
| `tt_matting_relight`（256×256，136 层） | `1.2e-7` | `2.0e-3` |
| `tt_matting_video`（288×288，136 层） | `4.2e-6` | `2.7e-3` |
| `facefitting_3d` MLP（212→442） | `2.4e-4` | `2.8e-4`（输出量级 255，相对 `1e-6`） |

两张抠像网络对原生的差全部来自最后的两类 softmax：运行库用相对通道 0 的指数配硬件倒数估计，
ONNX 只有普通 softmax。差值与解释器里测到的同一常数一致，不是权重或结构问题。

## 安全边界

密钥属于厂商运行库，只保存在 `.local/jianying-model-pytorch/tail-20260920/package-keys.txt`（不进 Git，权限 600）。
提交的宿主 `smash_package_host.mm` 从 `QCUT_SMASH_PACKAGE_KEY` / `QCUT_SMASH_PACKAGE_KEYS` 读取，仓库里没有任何密钥。
解出的图与权重同样只在 `.local/`。

## 证据目录（全部在 `.local/`，不进 Git）

`tail-20260920/`：`pkgcap-sticker`、`pkgcap-attr2`、`pkgcap-more`、`pkgcap-attr3`（拦截日志与密钥）、`effect-attr*`、`effect-more`（本地特效包）、
`pkg/<模型>`（解出的 config/weight）、`collected-pkg/`（5 张网络 + `manifest.json`）、
`parity-pkg-r2`、`parity-ae-seed41`、`parity-mv-seed41`、`parity-attr-seed41/509`、`parity-pkg-final509`、
`init-matting_video`、`ustq-agenet`、`ustq-expnet`（创建后堆扫描）、`bycap-fast-1..4`、`collected-fast`、
`parity-fast-seed41/509`、`effect-*`（逐轮特效包）、`micro-el`、`micro-el2`（探针图）。

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
