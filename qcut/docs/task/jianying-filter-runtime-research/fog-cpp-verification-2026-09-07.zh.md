# 迷雾标准 C++ 完整链验证

已恢复第二条完整复杂滤镜算法：横向阈值模糊 → 纵向模糊 → 遮罩 Screen 合成 → LUT。源码为 [independent-fog-contract](../../../research/independent-fog-contract/README.zh.md)，四阶段语义与原包定位见[语义核验](second-complex-filter-semantics-2026-09-07.zh.md)。结论限于固定资源版本、静态、不透明 RGBA8 SDR 和外部精确 LUT；没有声称整库恢复、GPU 逐位一致或产品适配完成。

## 可区分的三类证据

1. **原始包原生参考**：未修改 41 文件的迷雾包，独立 Swing child 收到真实 JSON 数值强度；D634 core、host、包文件和输入/输出 hash 均记录。两次完整矩阵各 30 个进程、210 个输出请求，全部 12 个代表性输入/输出 hash 跨批次相同。每请求内部两次 seek 不重复算作独立图像。
2. **新标准 C++**：每个参考运行两个独立进程，12 档共 24 次输出；像素对照和跨进程确定性都必须通过。C++ 不调用原生库，私有 LUT 仅作为外部数据读取。
3. **历史真实 UI**：核对历史 UI 导出的输入及 PNG，使用当前 C++ 新渲染；本轮没有重新操作剪映 UI，也没有新增产品 Preview/Export E2E。

原生固定强度的正反时间顺序、同会话强度切换与新进程都逐字节一致；四档均不同，排除了所有档返回原图的退化。零档输入逐字节一致，所有输出 alpha=255。最初 CGL composer 的强度被脚本读成 string，报错且输出不变，已保留失败证据并排除出有效 oracle。

## 原生参考对照结果

误差单位是 8-bit 通道值，MAE 对 RGB 全通道计算。每行都通过二次 CPU 进程确定性，alpha 最大差始终为 0。

| 自产图样 | 尺寸 | 强度 | RGB MAE | RGB 最大误差 |
| --- | --- | --- | --- | --- |
| chart | 320×180 | 0 | 0 | 0 |
| chart | 320×180 | 0.37 | 0.00473958 | 1 |
| chart | 320×180 | 0.5 | 0.00866898 | 1 |
| chart | 320×180 | 1 | 0.01451389 | 1 |
| offaxis | 257×145 | 0 | 0 | 0 |
| offaxis | 257×145 | 0.37 | 0.00484816 | 1 |
| offaxis | 257×145 | 0.5 | 0.00775527 | 1 |
| offaxis | 257×145 | 1 | 0.01742475 | 1 |
| threshold | 321×181 | 0 | 0 | 0 |
| threshold | 321×181 | 0.37 | 0.00293168 | 1 |
| threshold | 321×181 | 0.5 | 0.00664360 | 1 |
| threshold | 321×181 | 1 | 0.01298888 | 2 |

比较器固定门禁为非零档 RGB MAE≤0.25、最大误差≤4、alpha 差为 0；零档额外要求严格等于输入。没有根据每张图调宽门禁。最终加强后的比较器在 Release 和 ASan/UBSan 各运行全矩阵，两个构建的所有输出 hash 相同；报告不覆盖早期结果。

四档必须完整、像素 hash 必须各异、原始包/core/LUT 身份必须匹配。标志全为 true 仍不能绕过实际文件重读、零档非原图、缺失强度、重复强度和透明像素等拒绝规则。已保存参考的执行 runner hash 与后来加强门禁的验证 runner hash 分开记录，不把旧采集归属到新脚本。

## 历史 UI 对照

1280×720、100% 的新 CPU 输出对保存的真实 UI RGBA：RGB MAE **0.016788917824074073**，RMSE **0.12958880392168087**，最大差 **2**，仅 6 个 RGB 通道达到差 2；98.321325% 的 RGB 通道精确相同，alpha 最大差 0。

| 证据 | SHA-256 |
| --- | --- |
| 历史输入 RGBA | `b1eea462c6fbb6398d488fce9eef05c932924543c8a631d1f4e630a4c1e92bdf` |
| 保存的 UI PNG | `6e264d9b62aca50bb0fd4595d9a23bd32692348f98f29ca83871a942fc066fcb` |
| 解码 UI RGBA | `82a592bd08e03d7c5503b527ab1a7fdf14349da1a39251d2cb08a6c0cb26559b` |
| 新 C++ RGBA | `c46482d5f3d49b0642c6a50cc070c9112320559fcd6925de1bb3eb81a004ce07` |

七项输入/历史矩阵/PNG/解码像素/LUT 身份检查通过。原始 UI 来源标记为 2026-08-11，本地研究参考于 2026-09-06 保存，不能写成本轮新导出。原生时间序列检查使用静止输入，也不能升级为移动画面验证。

## 测试与剩余误差

本工程五项 CTest 包括：

- 解析式 17-tap impulse、严格阈值以及半像素采样后阈值顺序。
- 解析式 Screen/遮罩合成、每阶段 RGBA8、图次序、零档直通、强度非末端混合和输入不变性。
- CLI 非有限/非法输入、短文件、透明图、错误 LUT 以及失败不改既有输出。
- 原生 runner 的八组协议及全原图/部分强度碰撞负控。
- 比较器的十组身份/文件篡改/完整矩阵/零档严格像素等负控。

统一六工程本机 Release **40/40** 通过，ASan/UBSan、禁止恢复 **40/40** 通过；耗时分别 34.58 秒、42.18 秒。Release 同时编译所有可选原生诊断，但 CTest 不自动加载私有库。

所有验证使用源码内自产图样或外部私有证据。仓库不保存厂商 shader/Lua/LUT、反汇编、原生像素或模型。五个私有算法变异均成功编译、随后被断言检出：非严格阈值、忽略阴影遮罩、去掉中间 RGBA8、固定模糊强度、改成末端混合。两个基线测试合计 13,827 checks 通过；blur/composite/pipeline 各自的 fast-math 编译均被 IEEE 门禁拒绝。仓库源码与共享库 hash 前后相同，变异仅修改私有复制件。

剩余小误差可能来自通用 CPU 双线性采样、GLSL/Metal 插值/FMA 和设备 UNORM 写回。静态格式映射与最终像素一致性支持当前实现，但一次自有 child 的 draw 观察取得 0 个有效 Pass；没有原生中间图来逐阶段归因，也没有套用 Soft Glow 的 M4 13-stage profile。

本轮交付不包括通用滤镜图执行器、连续移动输入、透明/HDR、实时预算、新 CPU 产品 adapter 或新 UI/Preview/Export E2E。下一步可追原生中间 Pass 并做产品调用验证；这些边界继续保留在[执行队列](binary-cpp-execution-2026-09-07.zh.md)。

## 私有重查入口

以下路径均为本地证据，未加入 Git：

```text
/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/
  second-filter-native/matrix-final/manifest.json
  second-filter-native/verification.json
  second-filter-native/strength-negative-controls.json
  second-filter-native/historical-ui-cpu/metrics.json
  second-filter-native/fog-mutants/
  fog-cpp/native-comparison-final/metrics.json
  fog-cpp/native-comparison-san-final/metrics.json
  nonlinear-fog-builds/release-result.json
  nonlinear-fog-builds/san-result.json
  nonlinear-fog-verification.json
```

完整命令由各报告记录，构建/运行入口在源码 README。日志、源码 hash、像素结果和最终分支身份在总验证清单交叉索引；远程 CI 以当前 PR head 的 checks 为准。
