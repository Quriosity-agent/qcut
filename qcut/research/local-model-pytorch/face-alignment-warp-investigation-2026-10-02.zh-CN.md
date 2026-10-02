# 原始人脸旋转链：NewAlign、warp、颜色与网络输入

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 本轮结论

继续摸清原始实现，没有切换 QCut 编辑器后端，也没有新增独立人脸对齐器。
本轮从有限范围的二进制调用点检查走到真实 SDK 调用，不仅依据符号名推断。

- **72 组**显式点对的原始 `NewAlign` 拟合、正反矩阵与点映射通过。
- **78 组**原始 warp、颜色转换、实际 120/160 网络输入与重复推理通过。
- 其中 **18 组 RGBA 融合/非融合路径**输出逐像素一致。
- 恒等变换、整数平移/黑色补边另有 **20 组**直接像素索引控制，全部精确匹配。
- 重新启动进程再跑一遍：72 组矩阵和 78 组输入/原始输出哈希再次完全一致。
- 新增 26 个公开合成测试，相关回归共 **180 个通过**。

这证明显式控制下的原始子模块行为，不证明宿主的自动选点/路由、独立采样器、
实际关键点输出解码或最终美颜效果已完成。

## 坐标拟合是什么

实际调用 `ImageTransformNewAlign::setMeanFace` 和 `computeTransform`，
读取原始正向/逆向矩阵，再调用原始两种方向的点变换。
输入为交错排列的 `(x, y)` 点对；测试使用自建点集，不包含原始平均脸常量。

原始结果符合最小二乘**相似变换**：平移、旋转、统一缩放。
它不是自由的六参数仿射变换，也不是 X/Y 分别缩放。
诊断公式使用中心化点集 `p`、目标点集 `q`：

```text
d = sum(px*px + py*py)
a = sum(px*qx + py*qy) / d
b = sum(px*qy - py*qx) / d
A = [[a, -b], [b, a]]
t = mean(q_original) - A * mean(p_original)
forward = [A | t]
```

诊断用双精度累加、最后转 float32；原始路径有单精度累加。
因此矩阵对照是明确容差检查，不是逐位相等声明：

| 对照 | 实测最大绝对误差 | 门槛 |
| --- | ---: | ---: |
| 正向矩阵与诊断公式 | 0.000209808350 | 0.001 |
| 逆向矩阵与诊断公式 | 0.000123977661 | 0.001 |
| 原始点映射与矩阵乘法 | 0.000061035156 | 0.002 |
| 原始正向再逆向点映射 | 0.000030517578 | 0.002 |

72 组覆盖 2/7/106 点、-35/0/25/90 度、0.6/1/1.7 倍缩放和无噪声/0.3 噪声。
2/7 点用于解释算子，不声称实际宿主会用这些点数。
同一原始调用重复生成的矩阵逐位一致。

本轮**没有**证明 raw `fc_landmark_s1` 的 212 个值可以直接当作这些原图坐标。
原始模型的平均脸、点重排、单位和 Stage2 组合仍须单独捕获。

## 像素与颜色的执行顺序

像素控制用显式矩阵设置原始 `NewAlign`，分别执行：

```text
同一个源图 + 同一个显式正向矩阵
  → 原始 NewAlign::warpImage
  → 仅通道重排/去 Alpha 的控制结果

同一个源图 + 同一个显式正向矩阵
  → 原始 PreProcessor::ProcessWarpImage
  → 原始 BasePredictor::Predict
  → 读取实际网络输入与原始 212-float 输出
```

前一组隔离 warp 与颜色；后一组隔离准备好的像素与量化输入。
矩阵拟合与像素测试分开控制，因此尚不能把它称为宿主自动检测到最终关键点的完整闭环。

| 输入标签 / 枚举 | 原始非融合路径 | 网络前的准备结果 |
| --- | --- | --- |
| RGBA / 0 | warp 后颜色转换 | BGR，移除 Alpha |
| BGRA / 1 | warp 后移除 Alpha | BGR |
| BGR / 2 | 直接 warp | BGR |
| RGB / 3 | warp 后交换 R/B | BGR |

RGBA / 0 的融合标志会走融合 warp/颜色转换调用。
本轮对 18 组开启/关闭结果单独对拍，全部精确一致，不能泛化为所有尺寸/设备都一致。
Alpha 使用空间变化值且包含 0；本轮输入不做颜色预乘，控制也不要求透明像素的 RGB 归零。

78 组包括 60 组合成像素与 18 组已有生成肖像素材；肖像不是实际女团成员。
合成控制覆盖恒等、整数边界平移、0.65 倍缩放、-25/20/90 度旋转及四种颜色格式。
肖像用原始检测框 `[508, 183, 453, 632]` 定位显式裁剪中心，
测试 -20/0/20 度、120/160、RGB 与 RGBA 两条分支；这不是原始宿主选出的旋转角。

两种网络输入仍符合上轮结论：120 为 int16、160 为 int8，均 fraction=6，
实际整数值是准备好的 BGR 像素减 128，NHWC 内存布局。
每组准备像素、网络输入和原始输出的重复调用都精确相同。
本轮没有额外的 Inference 入口拦截；读取的是已有桥接器返回的实际张量，
不要将上轮入口拦截的独立证据冒充为本轮旋转链的入口捕获。

## 实际发现的灰度边界

首次完整扫描在灰度控制处失败，保留在私有 `face-alignment-warp-20261002-r1`。
另一次独立原始调用用 120×120、单通道、恒等矩阵复查：
输出 Mat 为 `rows=0, cols=0, data=null`，没有尝试网络推理。

有限调用点检查也看到低通道输入直接返回。这与上层留有灰度转换分支不等价：
不能只看到那个分支就宣称此版本支持单通道旋转。
新探针明确拒绝灰度与非法格式，避免空结果或先前预处理缓存被误当作成功。
这只是当前 SDK 子模块的边界，不是“剪映不能处理灰度画面”的产品结论；
灰度画面也可能由宿主预先扩成三通道。

## 文件与私有证据

公开仓库仅保存自写探针、测试和行为文档：

- `face_alignment_warp_native.py`：版本检查、原始 NewAlign/预处理调用与受控资源释放。
- `face_alignment_warp_verify.py`：阶段控制、误差门槛、原始输入/输出和灰度对照图。
- `face_alignment_warp_test.py`：公开合成测试、拒绝非法输入/退化拟合、证据门槛和资源边界。

运行库与模型锁定：

| 文件 | SHA-256 |
| --- | --- |
| `liblens.dylib` | `fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161` |
| 实际加载的 Filter `libbytenn.dylib` | `febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863` |
| 当前 FsNew 基础模型 | `89e4cf058aa4ec0eceda3ecffe6b5b599b718f58aaadac5e03e5c2c1b2d66227` |

探针枚举当前进程加载映像，要求唯一的 `libbytenn.dylib` 且哈希匹配，
不以 `current` 文件夹的文件存在代替实际加载路径。

全部原始像素、张量、运行桥接二进制与本地二进制检查材料留在忽略目录：

- `.local/jianying-model-pytorch/face-alignment-warp-20261002-r3/summary.json`
- 同目录 `geometry-results.json`、`repeat-run-summary.json` 和 78 个 `case-*`。
- `case-077/stages.png`：+20 度、160、RGBA 融合肖像对照；两张 x8 灰度差分全黑。
- `.local/jianying-model-pytorch/face-warp-gray-20261002-r2/descriptor.json`：空灰度输出。

不提交原始二进制、模型、平均脸常量、反汇编或私有输出。

## 复现

从 `qcut/` 目录运行，输出必须是新的私有子目录：

```bash
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
env DYLD_LIBRARY_PATH="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks" \
  "$PY" research/local-model-pytorch/face_alignment_warp_verify.py \
  --out .local/jianying-model-pytorch/face-alignment-warp-fresh \
  --image output/beauty-kpop-v6-20261002/source/kpop-front-original.png

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test face_geometry_test face_detector_test \
  face_alignment_input_test face_alignment_warp_test -v
```

公开 CI 添加新测试模块；跨平台合成测试不需要原始库。
私有原始 SDK 验证仍仅适用于锁定的 macOS arm64 版本，不能用 CI 绿色替代。

## 下一段

1. 捕获初始化和实际预测时的平均脸/参与拟合的点集，确认单位、点数和选择规则。
2. 把原始 raw 输出、重排、基准叠加和实际逆矩阵串起来，逐层对照原图坐标。
3. 再追 Stage2/眼睛/虹膜以及连续视频的分支和状态。

通用 warp 插值/舍入公式、历史渲染帧的自动路径、检测器同分排序压力失败、
最终变形/皮肤/妆容的剪映导出对拍也尚未在本轮解决。

关联：[上轮原始裁剪与输入](face-alignment-input-investigation-2026-10-02.zh-CN.md)、
[坐标链总表](face-geometry-investigation-2026-10-02.zh-CN.md)。
