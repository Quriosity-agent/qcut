# 独立 C++ 迷雾算法

这是第二条可独立编译的完整复杂滤镜算法链。它恢复迷雾 `7160594413847203085 / e745e131cff1db913aea07f4098ec8de` 的横向阈值模糊、纵向模糊、遮罩驱动的 Screen 合成和 64³ LUT，不加载剪映动态库。标准 C++20 实现复用 [Soft Glow](../independent-soft-glow/) 的图像、采样、RGBA8、LUT 和文件 I/O，不重复维护这些基础操作。

公开仓库包含自产算法、测试和图样生成器；真实调色仍需外部提供精确 LUT。省略 `--lut` 时使用自产 identity atlas，只演示算法，不代表原始迷雾的调色。

## 构建和运行

从 QCut 包根目录执行：

```bash
cmake -S research/independent-fog-contract -B /tmp/qcut-fog -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-fog --config Release --parallel 4
ctest --test-dir /tmp/qcut-fog --build-config Release --output-on-failure
/tmp/qcut-fog/independent-fog --demo --width 320 --height 180 --intensity 0.37 --output /tmp/fog-demo.ppm
```

Windows 多配置构建的可执行文件在 `Release/`。单独构建同时运行共享 Soft Glow 的七项测试和本工程五项测试，共十二项；[统一工程](../independent-binary-contract/)只添加一次共享目标。

真实参考使用 top-down、紧凑排列的不透明 RGBA8 SDR 输入和 512×512 RGBA8 atlas：

```bash
/tmp/qcut-fog/independent-fog --input /private/input.rgba --width 320 --height 180 \
  --intensity 0.37 --lut /private/fog-lut.rgba --output /private/fog-output.rgba \
  --trace /private/fog-stages
```

`--trace` 写出 `00-input`、`01-blur-x`、`02-blur-y`、`03-fog`、`04-lut` 五份同尺寸 raw RGBA。这些是独立 C++ 的阶段，不能称为已捕获的原生 GPU Pass。

## 合同和接口

- `blur.hpp`：17 点双线性采样，横向逐 sample 在插值后计算严格亮度阈值，纵向只过滤已有遮罩。
- `composite.hpp`：阴影遮罩系数 0.457、Screen 和 0.25 混合，再按原图权重合成；恢复原图 alpha 并限制 RGB。
- `pipeline.hpp`：固定四阶段依赖、输入/LUT 上传量化、每阶段 RGBA8 写回和可选阶段回调。
- 强度是有限 `double`，范围 `[0,1]`；按 Lua 表达式先计算 `(t×0.90)×4`、`1−t×0.50`，然后窄化为 float。它同时改变模糊、合成和 LUT，不是最终图与原图的一次混合。
- 管线拒绝透明输入、错误图形/atlas 尺寸、非有限强度。所有权由调用者保留，渲染不修改输入，也不保留上一帧状态。零强度最终像素严格等于上传后的输入。

具体原包地址、材质默认值、坐标方向、图依赖和证据边界见[语义核验](../../docs/task/jianying-filter-runtime-research/second-complex-filter-semantics-2026-09-07.zh.md)。`--intensity 1` 的事件参数不同于原始材质默认值。

## 对照和失败门禁

[原生采集器](../second-filter-native-reference/README.zh.md)在独立 Swing 子进程中加载未改动的原始包，并发送 JSON 数值强度。其固定原生矩阵包含三类自产图样、四档强度、正反时间序列和同会话强度切换。算法运行和 CI 均不需要私有库；本地差分需要已有私有参考与 LUT：

```bash
python3 research/independent-fog-contract/verify_native.py \
  --executable /tmp/qcut-fog/independent-fog \
  --manifest /private/matrix-final/manifest.json --lut /private/fog-lut.rgba \
  --output /private/new-fog-comparison
```

比较器固定 D634 core、包和 LUT 身份，重读输入/参考 hash，要求完整四档各异、稳定时间/进程/强度切换以及零档直通。每档执行两次独立 CPU 进程，检查确定性；非零档容差为 RGB MAE≤0.25、最大误差≤4、alpha 差为 0，零档还要求逐字节等于输入。拒绝复用已有输出目录以保留历史证据。

五项 CTest 覆盖：解析式 impulse 权重/半像素阈值次序、解析式合成/中间格式/完整图、CLI 错误输入、原生协议退化负控、比较器证据及像素门禁负控。Sanitizer 使用 `-DFOG_CONTRACT_SANITIZERS=ON`；fast-math/finite-only 编译模式拒绝。

当前实测与私有可重查结果见 [C++ 验证记录](../../docs/task/jianying-filter-runtime-research/fog-cpp-verification-2026-09-07.zh.md)。小于容差不等于逐位原生复刻：通用 CPU 采样器、GLSL/Metal 的插值/FMA和设备量化仍有差异。没有套用 Soft Glow 的设备转换 profile。

完整性限定于这条静态、不透明 SDR、外部 LUT 算法链。通用场景图、HDR/透明图、连续移动画面、实时性能、CPU 产品适配及 Preview/Export E2E 仍未完成；本轮没有新增剪映 UI 导出。
