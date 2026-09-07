# 剪映局部语义：五个独立 C++ 工程

本入口统一构建五个标准 C++20 工程及 23 组 CTest（含 Python CLI/分析测试）；默认不加载剪映、不依赖 Qt 或 Metal。

| 工程 | 自有实现 | 原生证据范围 |
| --- | --- | --- |
| [AGFX](../independent-agfx-contract/README.zh.md) | 格式、sampler 枚举、RGBA/BGRA 空间采样 | 格式差分、真实纹理与 sampler 像素；部分 LOD 边界未解 |
| [videoeditor](../independent-editor-contract/README.md) | 值状态、时间区间、关键帧投影、多通道重采样、实际属性 Bézier | 新增 128,392 个值的原生对照；NaN 只比较分类；完整选帧/seek 未闭合 |
| [VECreator](../independent-creator-contract/README.md) | 多选、请求、回调、服务端材质/已有 ID 关键帧更新、reset | 实际处理器静态恢复；常量与单值向量有原生对照；新建关键帧/undo 未闭合 |
| [lens](../independent-lens-contract/README.zh.md) | 六个数值原语、真实图像仿射与 RGBA→BGR | 3,892 组 / 161,540,260 字节零差异；不是完整防抖/去闪烁 |
| [Soft Glow](../independent-soft-glow/README.zh.md) | 既有完整柔光管线、13 个独立阶段重放 | D634 CGL 252 个实际阶段读回，末端 Normal 独立重放一致；整链精度仍有残差 |

从 QCut 包目录运行：

```sh
cmake -S research/independent-binary-contract -B /tmp/qcut-binary-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-binary-contract --config Release --parallel 4
ctest --test-dir /tmp/qcut-binary-contract --build-config Release --output-on-failure
```

Windows 把 `/tmp` 换成本机路径。ASan/UBSan 使用另一个构建目录和 `-DBINARY_CONTRACT_SANITIZERS=ON`；Clang/GCC 下错误立即失败，不支持的 MSVC 配置拒绝。五个子工程仍可单独构建。

macOS ARM64 可加 `-DBINARY_CONTRACT_NATIVE_PROBES=ON` 编译诊断程序；它们不加入默认 CTest，私有库需显式传入，未知身份拒绝。CI 在 Linux、Windows、macOS 构建独立源码，另跑 Linux sanitizers；macOS 编译原生诊断，并使用自产 CGL 图样验证捕获器，不携带或执行厂商库。

合并验证包含旧合同、新算法金样例、阶段解析负控和 CLI；各模块的原生差分结果、保护策略和未验证链路分别见工程文档。它们不能替代 QCut 编辑器预览、导出、撤销/重做或整库替换验收。当前批次构建及远端结果以[执行记录](../../docs/task/jianying-filter-runtime-research/binary-cpp-execution-2026-09-07.zh.md)和当前 PR head 为准。

详细进度见[执行记录](../../docs/task/jianying-filter-runtime-research/binary-cpp-execution-2026-09-07.zh.md)。
