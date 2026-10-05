# beauty-6-kpop：消费路由与剩余覆盖

日期：2026-10-05。分支：`beauty-6-kpop`。
起点：`06ae396205b706cea179c5027c09161a879ccc22`。
前置：[三线并行推进记录](beauty-kpop6-parallel-progress-2026-10-05.zh-CN.md)。

## 不能根据效果分类猜消费入口

前轮小脸、下颌线各三个人像都通过显式 `--route face` 执行，
六例均因缺少候选消费回执而失败。它们只证明该入口没有完成交接，不能证明模型精度有问题。

本轮重读原始 getter 调用栈，并对本机固定版本库作只读静态核对：

| 控制项 | 实际调用证据 | 下一步验证 |
| --- | --- | --- |
| 小脸 `face_adjust_YouTaiFace` | `FaceReshapeSystem` 的 update 调用多个 reshape 分支，再读取 type-4 人脸结果 | 需要独立的 reshape 发布与真实点读取证明，不能冒用美妆几何回执 |
| 下颌线 `face_adjust_XiaHeXian` | getter 栈中实际出现已研究的 `FaceMakeupSystemV2` update；不只是包内出现 FaceWarpX/阴影组件名称 | 用已有的显式 makeup 路由独立复测，仍要求 XY 读取、几何消费和最终像素全部通过 |

固定 core UUID 为 `D6342ECD-5432-33F0-A2AD-0C28F5699994`，
SHA256 为 `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
所有地址仅对这一版本有效，不作为跨版本 ABI。

- 小脸 update：`0x9d9428`；虚表 `0x35e58a0` 的 `+0xb8` 槽指向它。
  构造函数在 `0x9d5ae0` 形成该虚表地址并存入对象。
  update 内的日志标记及真实栈分别佐证 `FaceReshapeSystem` 身份与实际执行路径。
- 下颌线：getter 栈中的 update 返回位置为 `0x9ea1b4`、`0x9ea1bc`、`0x9ea1d8`，
  属于 `0x9ea110` 的 `FaceMakeupSystemV2`，与已有美妆入口一致。
- 原始记录在 `.local/jianying-model-pytorch/beauty-kpop6-parallel-face-20261005-r1/`，
  每个人像/控制项的 `audit/live/observer.json` 中。原始反汇编、库和人物素材不提交。

这纠正了“包名/组件名不同，所以必然不能使用美妆路由”的过度推断。
同时，getter 命中仍不是候选消费证明；一个系统消费成功也不自动证明复合效果的其他系统已接管。

## 本轮执行边界

三个 agent 分别处理剩余美妆矩阵、视频调试器停止诊断、内层滤波独立计算。
主线程集成、审核，并串行运行原生测试。研究源码在原生运行时冻结。

- 保持每个人像/控制项独立冷启动、零像素容差和效果活性检查。
- 不自动继续未知 `EXC_BREAKPOINT`，不把截断视频的部分成功改记成完整通过。
- 不把读取到的 native affine 矩阵或后验拟合当成独立几何实现。
- 不开放产品候选后端，不把本机研究结果扩展为 Windows、多脸、分钟级或预览/导出验收。

后续实测结果追加在本文；前轮失败目录保留。
