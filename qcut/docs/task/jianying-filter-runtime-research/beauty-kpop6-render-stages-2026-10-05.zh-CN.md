# beauty-6-kpop：美妆初始化与最终渲染阶段协议

日期：2026-10-05。分支：`beauty-6-kpop`。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。
本轮起点：`685099347f7c81f4751e50d2b229f4ba0490f30c`。
前置记录：[口红读取与发布检查点](beauty-kpop6-makeup-reader-checkpoint-2026-10-04.zh-CN.md)。

## 结论与边界

已解决上轮“初始化 seek 就被拒绝，尚未应用口红参数”的研究链阻断：
新增显式阶段模式后，真实运行完成初始化候选发布/恢复、参数应用、第二次新推理，
并进入美妆 V2 的最终几何处理 helper。

**没有宣称口红接管通过。** 当前仍缺少“几何转换读取的 XY 来自本次候选克隆”的直接证据，
最终渲染继续被严格拒绝。没有有效口红候选输出，不能计算原生/候选口红差分或宣称 RGBA 一致。
ONNX 数值误差也尚不是已证明的当前原因。

所有改动只服务本地研究模式；不启用 Electron 候选后端，不改变 UI，
不宣称摆脱剪映原生模型、检测、extra/遮罩或渲染器依赖。

## 阶段协议

新增 `face_live_render_stage.h` 的纯 C++ 状态机：

```text
fresh feature
  -> initializing: manager/time 0, fresh prediction 0
  -> restored publication after GPU completion (not landmark consumption)
  -> awaiting-parameters
  -> applying-parameters: same feature, native result 0
  -> ready: suppress initialization output
  -> rendering: same manager/time, fresh prediction 1
  -> require restored publication AND landmark consumption
  -> complete: only now allow final output
```

- 仅显式 `--stage-makeup-render` 启用，要求同时开启 `--publish-makeup-candidate`、
  `--trace-makeup-system`、`--single-frame --cold-frame`。
- 通过固定 UUID 的 `bef_swing_segment_set_params` 真正调用结果记录参数应用，
  不是猜测“第二次 seek 应该已经生效”。空 payload、错误线程、错误 feature 和非零返回值均拒绝。
- 初始化必须有本次新推理、独立克隆发布、GPU 完成和原始数据恢复，才允许继续。
  `acknowledgeInitialization()` 不设置 `consumed`，也不生成 `live_owned_conversion`。
- 初始化确认只针对冷启动预测 0 / 时间 0，不能重复或借给预测 1 使用。
  未开启阶段模式的既有冷启动仍要求预测 0、1 都有真实消费。
- 错误顺序、重入、缺少预测、重复预测、换 manager/feature、缺少参数、参数失败、第三次 seek，
  都让状态机进入不可重试的 `failed` 状态。不能用重放或隐式预热逃过检查。
- 美妆观察/发布代码移到 `face_live_makeup_hooks.h`，与纯阶段状态机及通用 lease 生命周期分开。

## 初始化图不得冒充最终效果

原宿主每个请求先写初始化帧，再用最终渲染覆盖同一输出路径。
以前初始化检查就失败，没有暴露这个输出问题；阶段打通后，r2 最终验收失败却留下初始化 RGBA。
这个文件只是中间产物，**不得当作口红候选输出或用于效果对比**。

现已在帧写入处增加仅研究编译启用的阶段检查：
初始化参数应用后可继续流程，但写图被抑制；只有最终阶段完整验收通过才允许输出。
其它宿主未定义该编译开关时无此分支；普通 FaceAdapter 模式也不启用该策略。
r3 记录 `live_initialization_output_suppressed`，最终失败后 `live/` 内没有任何 `.rgba` 文件。

## 真实本机运行

输入与强度沿用前置检查点：`front-smile-original.jpg`，640 x 640，
`face_adjust_lip_yunranColorRHF` 强度 0.8、柔和粉动态效果包。
固定 libcccreator UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`；
SHA256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。

以下目录均位于 `.local/jianying-model-pytorch/`：

| 运行 | 结果 | 解释 |
| --- | --- | --- |
| `beauty-kpop6-lip-stages-20261005-r1` | 准备阶段拒绝，未运行原生推理 | 子任务增加 C++ 测试时触发源码目录快照变化；不是算法失败，未绕过 guard |
| `beauty-kpop6-lip-stages-20261005-r2` | 已进入最终几何路径，消费验收失败 | 两次预测、两次独立发布和 GPU 后恢复；遗留初始化 RGBA，不是有效候选图 |
| `beauty-kpop6-lip-stages-20261005-r3` | 阶段推进可复现，输出防误报通过；消费验收仍失败 | 初始化输出已抑制；无候选 RGBA；原始数据恢复成功 |
| `beauty-kpop6-eye-stage-regression-20261005-r4` | 大眼 +40 冷启动正向回归通过 | 2 次预测、2 次真实转换、2 次恢复；未启用美妆阶段开关 |
| `beauty-kpop6-lip-stage-off-20261005-r5` | 关闭阶段模式的负向对照通过 | 仍在预测 0 拒绝缺失消费，不进入参数应用或预测 1，无候选 RGBA |

大眼回归：原图改变 4,760 像素，最大差 30，变化框 `[212,109,408,173]`；
原生/候选 RGBA 差异像素为 0，最大差为 0。
两者 SHA256 都是 `c76dbca3b0ef4a3aa0fa9eefaef1ad7695723cd545eee1133034afbadfa40ac8`，
与前一轮完全一致。本次接线和公共帧写入分支没有改变这条已验证输出。
本轮 r1-r5 均完成进程清理；有效原生运行 r2-r5 的依赖检查未发现变化。

r3 的关键事件顺序：

```text
stage_begin(initializing)
candidate_received(0)
makeup_publication(binding 1, graph 1)
owned_rollback(0, gpu_complete=true, original_restored=true)
stage_complete(initializing, renderer_consumption=false)
feature_parameters_applied(result=0)
initialization_output_suppressed
stage_begin(rendering)
candidate_received(1)
makeup_publication(binding 2, graph 1)
owned_rollback(1, gpu_complete=true, original_restored=true)
reject: makeup final rendering lacks landmark consumption
```

只读 raw-getter 栈进一步看到预测 1 的 `0x9eb940` 几何 helper，
读取 base (`0xc165f0`)、extra (`0xc16634`) 和 aux (`0xc166bc`)，上层为 `0x9ea110`。
这是比上一轮预测 0 的数量/metadata 路径更进一步的动态证据，但不是 XY load 的来源证明。
不能将 getter 命中直接转成 `liveLeases.converted()`。

## 自动测试

- 阶段状态机：2 条有效完整流程、204 个拒绝场景及失败后重试检查；ASan + UBSan 通过。
- 克隆 lease 生命周期：17 项通过，ASan + UBSan 通过；初始化确认必须有真实恢复，且不得泄漏到最终预测。
- 6 个 Python 套件：75 项通过，无跳过。覆盖研究模式组合、基线环境隔离、复现命令、
  成功宿主响应不能将 publication-only 判为通过。
- 未进行本轮 Electron UI E2E、剪映 GUI 导出、分钟级、多脸、Windows/x86 或产品全量 CI 验收。

```bash
cd /Users/peter/Desktop/code/qcut/qcut
xcrun clang++ -std=c++20 -Wall -Wextra -Werror -fsanitize=address,undefined \
  research/local-model-pytorch/face_live_render_stage_test.cpp -o /tmp/qcut-render-stage-test
/tmp/qcut-render-stage-test
xcrun clang++ -std=c++20 -Wall -Wextra -Werror -fsanitize=address,undefined \
  research/local-model-pytorch/face_live_bridge_lifecycle_test.cpp -o /tmp/qcut-lease-test
/tmp/qcut-lease-test
```

真实重跑使用审计 `report.json` 的 `command`，更换输出目录和 Python cache prefix，
确认稳定签名宿主/GPU lease 空闲。运行期间冻结 `.py/.mm/.cpp/.h` 文件；C++ 测试也在目录 guard 中。
本轮没有提交人物图、私有运行库、模型、效果包、完整日志或会话凭据。

## 下一步

1. 在预测 1 的最终美妆更新中，用独立只读探针观察 `0xa2072c` / `0xa207ec` 的 base/XY 读取。
   将读取地址和值与 `owned_base/owned_points`、binding、graph、预测、线程和阶段逐项关联。
2. 只有来源匹配后才设计美妆专用消费收据；主 106 点和 extra 分别说明，不用数量/metadata 代替 XY。
3. 给 Python/Electron 审计加入同一阶段和消费协议，再移除 publication-only 的强制失败门槛。
   在此之前产品候选后端保持禁用。
4. 同值输入验证零 RGBA 差异，再做受控嘴唇点扰动及差分图，证明结果确实由候选点驱动。
5. 单图单口红通过后才扩展不同妆容、不同人物/强度、UI、视频、多脸和跨平台。
