# 2026-09-10 第五批：Caption 颜色、节点记录选择、MergeUtil 整链与两个高斯 Pass

本批接续第四批，继续使用 `codex/jianying-binary-cpp-batch4-20260910` 与
`/Users/peter/Desktop/code/qcut-binary-cpp-scaleup-wt/qcut`，[PR #470](https://github.com/Quriosity-agent/qcut/pull/470) 保持开放。
起点是第四批交付后的 64 组 CTest。

## 四条交付

| 线 | 新增独立 C++ | 实际原生比较 | 未完成范围 |
| --- | --- | --- | --- |
| videoeditor | `caption_color`：Caption 颜色路径（0x33f4c84）的求值本体与门禁叶子谓词 `isCaptionType` | 473,968 次调用；1,895,672 个 double 逐位一致 + 50 项谓词比较，零差异 | [交付记录](videoeditor-caption-color-2026-09-10-batch5.zh.md)；`isCaptionText` 未还原，未与 `property_dispatch` 接线 |
| lens | `merge_util`：`Rigid2Lock → 框中心平移 → Move::Run(border 11) → Lock2Rigid → 输出置换` 整链 | 387,498 次真实调用、1,338,580 个值零差异 | [交付记录](lens-merge-util-2026-09-10-batch5.zh.md)；**52,836 次调用被独立实现拒绝**，见下 |
| VECreator | `keyframe_stash`：`get_stash_copy` 的节点级记录选择走查 | 2,207 案例、397,277 项比较零差异 | [交付记录](creator-keyframe-stash-2026-09-10-batch5.zh.md)；**不是既定条目**，见下 |
| AGFX | `gl_fragment_profile`：柔光链两个高斯 Pass 的片元算术 profile | 12 个钉住 draw、608,256 字节归因，零差异 | [交付记录](agfx-gl-fragment-arithmetic-2026-09-10-batch5.zh.md)；**工作包 04 整体未关闭** |

### 三条必须写在明处的边界

**1. lens 的拒绝域比结论域大。** 387,498 次原生调用里，**52,836 次被独立实现拒绝**，其中 51,606 次原生返回了四个完全有限的 float —— 也就是说在这些输入上原生给得出结果而本实现拒绝。零差异只成立于被比较的 334,645 次调用，不能读成"整条 MergeUtil 已对齐"。

**2. VECreator 交付的不是既定条目，理由是二进制事实。** 既定条目是 Session 级记录选择与事务边界。实测：Session 级唯一事务入口 `draft_store::IOManager::startTransaction/commitTransaction` 会碰真实草稿文件（任务禁止）；真正的记录生成点 `lvve::Draft::get_stash_copy` 依赖 `reorganize_dirty_states` 展开的几十个异质子类族，一批做不完；而 `libVECreator.dylib` 的 1,066 个导出里根本没有这条面，整套记录机器在 `libvideoeditor.dylib`。本批因此交付节点级的 `get_stash_copy` 走查——它是第四批 `get_all_nodes` 产物的直接消费者，**但只在节点层，没有碰提交/回滚**。

**3. AGFX 这次正面攻了工作包 04，但只关闭其中两个 Pass。** 本批闭合柔光链的 Gaussian X / Gaussian Y。**明确不在域内**：Glow mask、Glow 的 packed RG/BA 模糊、Glow composite、LUT pass、Normal、两个 blit、以及迷雾整链。片元控制流读自钉住的柔光特效包里的**明文 GLES2 源码**，不是从 dylib 反汇编逆出来的——这一点在交付文档 §1.2 已写明。

## 统一验收

| 检查 | 本机结果 |
| --- | --- |
| Release，统一入口 | 70/70 CTest，25.67 秒 |
| Debug ASan/UBSan，禁止错误恢复 | 70/70 CTest，62.47 秒 |
| 编译告警 | 两套构建均 0 条（`-Werror` 保持开启） |
| 新 head 跨平台 CI | 推送后在 PR #470 验收；本机结果不代替云端结果 |

CTest 从 64 增至 70：Editor +1、Creator +1、Lens +3、AGFX +1。

## 负控

| 线 | 编译并运行 | 被检出 | 未检出的性质 |
| --- | --- | --- | --- |
| videoeditor | 14 | 11 | 2 个结构性不可观测（NaN 经量化后与 guard 回落逐位相同；±0 的符号被 blend/fmod 吸收，实测那行执行了 915 次而输出一位不变）、1 个本批原生对照结构性够不到 |
| lens | 17 | 16 | 1 个 |
| VECreator | 16 | 14 | 2 个语义等价程序；另有 2 个在独立侧根本写不出来，只记台账不计入编译数 |
| AGFX | 13 | 5 | 8 个在 8 位输出上不可观测 |

AGFX 的 5/13 是本批最低的检出率，如实列出，不靠补样例修饰。

## 一次本机与对抗审计都没抓到的可移植性问题

第四批推送后，云端 CI 在 Linux 与 Windows 上以 `lens-rigid-lock-contract` 失败，原因是把本机 libm 的位钉进了跨平台默认测试（详见[第四批记录](binary-cpp-batch4-2026-09-10.zh.md)）。

本批交付后按同一标准复查了四个新单元的 libm 使用：

- `caption_color` 只用 `std::fmod`。fmod 由 IEEE 754 精确定义、无舍入，**可移植**，因此其指纹不加平台守卫。
- `merge_util`、`keyframe_stash` 不调用 libm。
- `gl_fragment_profile` 使用 `std::exp` 与 `std::pow`，两者**都不是精确定义的**。其中一处在测试时重算 `shader_tap_weight`（直接是 `std::exp`）再与钉住的 GPU 实测值比较"差几个 tap"——这个计数由本机 libm 决定，与第四批出事的模式相同，已加平台守卫。同名的 `libm_differences` 断言另有两处比较的是夹具里记录的常量，测试时不调用 libm，属自洽断言，未改。

四个实现 agent 与四个对抗审计**全部只在 macOS arm64 上运行**，都没有发现这一类问题。云端跨平台 CI 仍是唯一有效的门禁。

## 仍未关闭的工作

**六个独立工程、两条完整标准 C++ 滤镜链、整库 0/6、八个未完整关闭的大工作包**口径不变。本批四个子项各自闭合一个有界单元，**八个工作包仍然一个都没有关闭**——工作包 04 首次被正面推进，但只闭合其中两个 Pass。CTest 从 64 到 70 不构成完成度推导。

原始 ASM、厂商数据、原生 JSON、负控产物、源码 hash 与构建日志全部在
`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/batch5/` 下的 `editor/`、`creator/`、`lens/`、`agfx/`，不入 Git。
