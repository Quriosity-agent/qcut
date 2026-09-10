# 2026-09-10 第四批：属性分派、历史索引、刚体锁转换与平面格式

本批从远端默认分支 `master` 的 `97cf30a83fddc4b9f94bbc5f9dad47b8ed3f3809` 新建 `codex/jianying-binary-cpp-batch4-20260910`，工作树为 `/Users/peter/Desktop/code/qcut-binary-cpp-scaleup-wt/qcut`。上一批 [PR #469](https://github.com/Quriosity-agent/qcut/pull/469) 已于 2026-09-09 合并（合并点 `a52a891d1`）并随 v2026.09.09.1 发版，起点已包含该合并。

继承六个独立 C++ 工程、两条完整滤镜算法链和 58 项 CTest。起点已有代码不是本批新增结果；整库恢复仍没有完成。

## 四条并行交付

| 工作线 | 本批新增独立 C++ | 实际原生比较 | 状态与边界 |
| --- | --- | --- | --- |
| videoeditor | `dispatch_property_values`：窗口选择→exact-hit/单邻居拷贝→形状检查→回绕中点→三次映射→越界钳位→curve 路由→线性三段分离运算或记录+cubic | 384 配置、15,903 次真实 property 调用零差异；39,188 个非 NaN double 逐位一致、3,348 次 NaN 分类一致、17,067 次整数检查；15,903 次 hit/prev/next 对象 identity 交叉核对 | [属性分派交付](videoeditor-property-dispatch-2026-09-10.zh.md)；11 条 Segment 默认取值链、Caption 颜色路径、带 graph 的路由与其他 Segment 仍缺 |
| VECreator → videoeditor | `get_all_nodes` 节点历史索引与两个 escape hook，覆盖七个被遍历类 | 4,614 案例、159,401 项比较零差异，四次独立运行计数与覆盖完全一致 | [历史索引交付](creator-history-index-2026-09-10.zh.md)；Session 记录选择、事务提交/回滚、undo/redo 回放仍缺 |
| Lens | `rigid_to_lock` / `lock_to_rigid`：MergeUtil 在 Move 约束核两侧调用的两个坐标转换 | 1,332,811 次真实调用、5,331,244 个 float32 字段逐位一致，Release 与消毒器输出逐字符相同 | [刚体锁转换交付](lens-rigid-lock-conversion-2026-09-10.zh.md)；SettingInfo 未配置，整个 MergeUtil 未调用 |
| AGFX | `cv_plane_format`：CoreVideo 四字符码平面解析的三棵决策树与一个次入口 | 穷举 17,179,869,184 组合、137,438,953,472 个值逐位比较零差异；另 28 次 CVBuffer 比较；两进程除计时外逐字节相同 | [平面格式交付](agfx-cv-plane-format-2026-09-10.zh.md)；**这是整数控制流合同，不是 GPU 算术还原** |

### AGFX 本批交付的不是原定条目

第三批定的下一顺序是「AGFX 回到真实滤镜中间 Pass 残差」。本批实际交付的是 CoreVideo 平面格式解析，属于另一个相邻子项。**工作包 04 的逐 Pass 残差归因没有推进**，柔光卷积/Glow/LUT 与迷雾采样舍入的残差仍未归因。本条不得记作 04 的进度，也不能说成又一个 M4 硬件实测 profile —— 它是确定性控制流，不依赖 GPU。

## 统一验收

六工程保持不变，CTest 从 58 增至 64：Editor +1、Creator +1、Lens +3、AGFX +1。

| 检查 | 本机结果 |
| --- | --- |
| Release，统一入口 | 64/64 CTest，24.02 秒 |
| Debug ASan/UBSan，禁止错误恢复 | 64/64 CTest，60.05 秒 |
| macOS arm64 全部可选原生探针编译 | 全部编译通过，含本批四个新增诊断程序 |
| 编译告警 | Release、消毒器、原生探针三套构建均 0 条（`-Werror` 保持开启） |
| 四线原生对照 | 各线最终报告零差异；厂商 dylib 自身未插桩 |
| 旧原生回归 | Editor graph / nonlinear_property / variable_graph 与 Lens 七个既有 oracle 重跑，JSON 与既有记录一致 |
| 新 head 跨平台 CI | 推送后在新 PR 验收；本机结果不代替云端结果，旧 PR #469 绿灯不沿用 |

统一构建入口为 [independent-binary-contract](../../../research/independent-binary-contract/README.zh.md)。

## 负控与未检出项

四线共建 47 个故意改错的变体，41 个被检出。未检出的六个全部保留记录，不删除：

| 线 | 未检出变体 | 原因 |
| --- | --- | --- |
| videoeditor | `empty-copy-returned` | 空拷贝回落与 11 条 Segment 默认链在入口处都返回空 `vector<double>`，原生输出无法区分；只被 standalone 分支断言检出 |
| VECreator | `escape-skips-graph`、`escape-visits-retained`、`escape-order-reversed` | 这七个类的 escape hook 本身不插入也不写入（`CommonPoint` 是单条 `ret`），escape 脊柱的形状**结构性不可观测**，任何 oracle 都恢复不了 |
| Lens | 反向常量改写成 `57.29578f` | 与 `57.295780181884766f` 是同一个 binary32 `0x42652ee1`，属于非变异而不是漏检 |
| AGFX | `unsigned_pivot` | 三棵树里被比较的常量都小于 2^31，带符号位的源码在枢轴两侧都被拒绝；穷举也无法区分。默认 CTest 断言它保持不可区分，一旦不成立立即报错 |

另有一个 Lens 真变体（`powf(x, 2.0F)` 改成 `x*x`）**只被原生对照检出、不被默认 CTest 检出**：钉住的金样例恰好没有落在两者产生差异的取值上。如实记录，不追加样例来掩盖。

## 仍未关闭的工作

**六个独立工程、两条完整标准 C++ 滤镜链、整库 0/6、八个未完整关闭的大工作包**的口径不变，详见[剩余台账](binary-cpp-reconstruction-backlog-2026-09-06.zh.md)。本批四个子项各自闭合一个有界单元，**八个工作包一个都没有关闭**。测试数从 58 增到 64 不构成完成度推导。

后续顺序：videoeditor 补 11 条 Segment 默认取值链与 Caption 颜色路径，再并入带 graph 的分派路由；VECreator 从历史索引推进到 Session 记录选择与事务边界；Lens 配置 SettingInfo 并调用整个 MergeUtil，做两侧转换后的整链对照；AGFX **回到工作包 04 的真实滤镜逐 Pass 残差**，本批的平面格式不替代该项。之后再推进通用效果图、迷雾 CPU 产品出口与 ByteNN 张量/模型合同。

本批没有把局部数值合同写成 QCut Preview/Export、撤销重做或 UI 像素验收。原始 ASM、厂商数据、原生 JSON、负控产物、源码 hash 与构建日志全部在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/` 的 `editor/`、`creator/`、`lens/`、`agfx/` 下，不入 Git。
