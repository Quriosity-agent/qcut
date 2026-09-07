# 剪映语义与滤镜算法：六个独立 C++ 工程

本入口统一构建六个标准 C++20 工程，当前含52组CTest：09-07基线40组，09-08首批增至46，第二批曲线时间/图快照/空间精度各增1组、Lens取景数值与CLI增3组。本机Release（含全部可选原生探针编译）和禁止恢复的ASan/UBSan均52/52。默认不加载剪映、不依赖Qt或Metal；新head的云端CI单独验收。

其中电影柔光和迷雾是两条完整标准 C++ 滤镜算法链；其他工程交付局部合同或图像原语。六个工程不表示六个原生库被重写，整库完成数仍为 0/6。迷雾新 CPU 产品 adapter、Preview/Export 和 UI E2E 尚未接入。

| 工程 | 自有实现 | 原生证据范围 |
| --- | --- | --- |
| [AGFX](../independent-agfx-contract/README.zh.md) | 格式、sampler 枚举、RGBA/BGRA 空间采样 | 格式差分、真实纹理与 sampler 像素；新增M4 LOD与字节混合profile逐位对照；另新增72,474,112通道的有界2D空间精度profile；多层linear+linear及其他设备未闭合 |
| [videoeditor](../independent-editor-contract/README.md) | 值状态、重采样、Bézier、窗口、恒速时间、线性/非线性属性子域 | 本批非线性 117,515 次真实调用/784,545 值：729,127 非 NaN 逐位一致、55,418 NaN 分类一致；限预选两帧、无 graph、至少一侧 curve 非零和非命中 raw midpoint。09-08另有非空graph的1,673配置原生对照；另新增正向曲线积分/逆映射与无graph属性组合；graph+变速、完整分派/seek未闭合 |
| [VECreator](../independent-creator-contract/README.md) | 多选、请求、回调、服务端材质/reset、已有 ID 更新、已解析时间的新建/插入/control | 实际处理器静态恢复；常量、向量和新增插入/control 有真实 SDK 对照；新增 2244 组 dirty/retained 生命周期原生对照；09-08新增局部记录恢复3,842案例零差异；另新增Graph子树/数组恢复及两级stash，4,738案例/692,606项零差异；完整定位/Session undo未闭合 |
| [lens](../independent-lens-contract/README.zh.md) | 六个数值原语、真实图像仿射与 RGBA→BGR | 保留 base 对照；NEON/ImageTransform 各 10,998 组，445,847,787 字节零差异；新增 crop 变换计划 363,684 float 与真实对象 warp 1,324,512 字节零差异；09-08新增65,536帧RectSmoother及128帧warp组合；另新增CenterFocus/Cropper选择链，3,208,960个SDK值逐位一致；不是完整防抖/去闪烁 |
| [Soft Glow](../independent-soft-glow/README.zh.md) | 完整柔光管线、13 个独立阶段重放、精确 UNORM8 与字节域末端混合 | D634 CGL 252 个实际阶段读回，末端 Normal 独立重放一致；自产 CGL 转换 666,580 通道零差异；新增 M4 blit 的浮点/字节及反向坐标配置验证，两次缩放独立重放均 0 差异；整链精度仍有残差 |
| [Fog](../independent-fog-contract/) | 完整迷雾四段管线、17 点采样阈值/模糊、Screen 合成、LUT、CLI 和阶段输出 | 未修改原包的 D634 Swing 数值事件，30 进程/210 帧稳定且四档各异；12 组 C++ 对照 MAE 0–0.017425、最大误差 2，按[最终验证](../../docs/task/jianying-filter-runtime-research/fog-cpp-verification-2026-09-07.zh.md)的容差验收。中间 Pass 精度未实测闭合，CPU 产品接入未完成 |

从 QCut 包目录运行：

```sh
cmake -S research/independent-binary-contract -B /tmp/qcut-binary-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-binary-contract --config Release --parallel 4
ctest --test-dir /tmp/qcut-binary-contract --build-config Release --output-on-failure
```

Windows 把 `/tmp` 换成本机路径。ASan/UBSan 使用另一个构建目录和 `-DBINARY_CONTRACT_SANITIZERS=ON`；Clang/GCC 下错误立即失败，不支持的 MSVC 配置拒绝。六个子工程仍可单独构建；Fog 复用 Soft Glow 的自有 Image/IO/LUT，独立配置时自动构建该源码依赖，不复制实现。

macOS ARM64 可加 `-DBINARY_CONTRACT_NATIVE_PROBES=ON` 编译诊断程序；它们不加入默认 CTest，私有库需显式传入，未知身份拒绝。CI 在 Linux、Windows、macOS 构建独立源码，另跑 Linux sanitizers；macOS 编译原生诊断，并使用自产 CGL 图样验证捕获器与 float→RGBA8 转换，不携带或执行厂商库。

合并验证包含旧合同、新算法金样例、阶段解析负控、CLI、原生协议与参考验证器负控。默认测试中的“原生协议/验证器”只使用自产临时数据，不偷偷加载厂商库。各模块的真实差分、保护策略和未验证链路见工程文档；它们不能替代 QCut 编辑器预览、导出、撤销/重做或整库替换验收。历史迷雾 Metal 产品证据也不替代新标准 C++ 路径验收。当前构建及远端结果以[执行记录](../../docs/task/jianying-filter-runtime-research/binary-cpp-batch2-2026-09-08.zh.md)和当前 PR head 为准。

详细进度见[执行记录](../../docs/task/jianying-filter-runtime-research/binary-cpp-batch2-2026-09-08.zh.md)。
