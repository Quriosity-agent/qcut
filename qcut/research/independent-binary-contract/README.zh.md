# 剪映局部语义：四个独立 C++ 工程

本入口统一构建四个标准 C++20 静态库及 12 组 CTest；默认不加载剪映、不依赖 Qt 或 Metal。

| 工程 | 自有实现 | 原生证据范围 |
| --- | --- | --- |
| [AGFX](../independent-agfx-contract/README.zh.md) | 格式、sampler 枚举、RGBA/BGRA 空间采样 | 格式差分、真实纹理与 sampler 像素；部分 LOD 边界未解 |
| [videoeditor](../independent-editor-contract/README.md) | 值状态、时间区间、关键帧 JSON/转移投影 | setter/getter、隐藏 JSON helper；序列插入仍是静态语义 |
| [VECreator](../independent-creator-contract/README.md) | 多选聚合、请求、模型门控、对话回调 | 分支来自静态控制流；仅两个常量有直接原生差分 |
| [lens](../independent-lens-contract/README.zh.md) | 矩阵乘/逆、高斯核/平滑、旋转/点变换 | 六个数值原语逐位差分；不是完整防抖/去闪烁 |

从 QCut 包目录运行：

```sh
cmake -S research/independent-binary-contract -B /tmp/qcut-binary-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-binary-contract --config Release --parallel 4
ctest --test-dir /tmp/qcut-binary-contract --build-config Release --output-on-failure
```

Windows 把 `/tmp` 换成本机路径。ASan/UBSan 使用另一个构建目录和 `-DBINARY_CONTRACT_SANITIZERS=ON`；Clang/GCC 下错误立即失败，不支持的 MSVC 配置拒绝。四个子工程仍可单独构建。

macOS ARM64 可加 `-DBINARY_CONTRACT_NATIVE_PROBES=ON` 编译诊断程序；它们不加入默认 CTest，私有库需显式传入，未知身份拒绝。CI 在 Linux、Windows、macOS 构建独立源码，另跑 Linux sanitizers；macOS 仅编译原生诊断，不携带或执行厂商库。

本机合并构建 Release 与 ASan/UBSan 均 **12/12** 通过，全部五个可选诊断程序编译通过。原生差分结果、保护策略和未验证链路分别见各工程文档；它们不能替代 QCut 编辑器预览、导出、撤销/重做或整库替换验收。

详细进度见[执行记录](../../docs/task/jianying-filter-runtime-research/binary-cpp-execution-2026-09-07.zh.md)。
