# 手动局部缩放：从拟合反解改为原生规则的有限网格

本次只收敛手动美体的「放大缩小」。它现在使用自写的径向方程、250×250 网格及公开 Metal 光栅器，不读取原版模型、特效包或动态库。拉长与瘦身保持原实现。

12 组原生图片对照（720×1280、1080×1920；正负强度；不同圆心与半径，包含越界圆和最小半径）中，RGB 平均绝对差为 **0.000196–0.000222**，RGBA 最大差 **1**。原来 8 个对应常规用例的拟合路径平均差是 **2.575–2.691**。这些结果来自图片像素对拍，尚不能等同于视频、预览和导出的全链路验收。

## 找到的规则

令源点相对椭圆中心的距离为 `d`，该方向的边界半径为 `R`，`r = d / R`：

```text
t = clamp(powf(r, h), 0, 1)
weight = 1 - t*t*(3 - (t+t))
forward_delta = (point - center) * weight * amount

放大：h = float32(1.8)，amount = float32(intensity/100) * float32(0.4)
缩小：h = float32(3)，amount = float32(intensity/100) * float32(0.25)
```

正负硬度来自直接调用原生几何构造器，并通过私有特效包副本的只读属性探针确认实际加载值。原生径向函数的 60,042 个样本与独立方程逐 float32 位一致，包括中心、圆边缘和边界外值。

原来的 `(1-r^a)^b` 拟合只逼近这个权重。仅将该公式换成正确权重，图片平均差仍在 2.6 左右；主要缺口是有限网格与全图重采样。

实际加载的 `canvasSize` 是 **float32(1.2)**，构造器默认值则是 1。每轴流程为：

1. `expanded = ceil(float32(frameSize * float32(1.2)))`。
2. 按 `expanded / 250` 生成网格。
3. 根据 `(expanded-frameSize)/2` 计算可见区域的两条网格索引，将它们的坐标固定到画面边界。
4. UV 按这两条索引的间距归一化。
5. 圆框角点先经过 float32 坐标转换、画布偏移、像素尺度变换，再截断为整数；因此最终区域有时是略不等轴的椭圆。
6. 在网格顶点应用正向位移，再用原生相同的三角索引插值。
7. 输出位置减去未向上取整的 `float32(frameSize*1.2)/2`，再转为标准化设备坐标。

这个取整顺序解释了旧报告中尚未复现的亚像素偏移。例如，720 的扩展宽度是 **865**，而非按双精度心算得到的 864；边界落在 72.5 和 792.5。1080 的对应边界则是 108 和 1188。

## 原生验证与回归

| 范围 | 结果 |
|---|---|
| 原生径向函数，6 个硬度、60,042 个输入 | 最大绝对误差 0，最大 ULP 0 |
| 原生位移场与应用，5 组画幅/区域，每组 63,001 顶点、5 档强度 | 位移场、最终坐标逐位一致 |
| 完整初始化、固定边界、UV、三角索引、椭圆和形变，5 个画幅 × 3 个区域 × 正负强度 | 30 组全部逐位一致；包含非整除尺寸和越界圆 |
| 原版 provider 与当前生产自研输出 | 12 图，平均差 0.000196–0.000222，最大差 1，全部不透明 |
| 修改前的 half shader 与新默认 body profile | 120×200、720×1280、1080×1920，3 组逐 RGBA 字节一致 |
| 手动美体 Python 测试 | 26 通过，包含 canonical 子进程/常驻顺序与新增几何/门禁测试 |
| 智能美体 renderer Python 测试 | 12 通过 |
| 空运行目录＋系统文件沙箱 | 12 图仍最大差 1；目录内仅生成自写 Metal 可执行文件，无原版资产 |

这里的逐位坐标验证使用共享的明确输入网格/区域，对原生 CPU 函数直接调用；图片验证另外调用实际原生 provider，覆盖包加载、序列化参数及完整像素输出。两类证据分别保存，未将前者外推为完整渲染逐位一致。

独立隔离复验使用另行复制的源图，并禁止读取剪映／CapCut 应用、私有原生运行库、原模型目录、桌面参考实现和整份原生探针目录。三项负向读取控制均收到系统 `PermissionError`。候选先在空目录完成全部输出，再由另一进程读取原生图片比对；候选不接收原生网格或图片。证据位于 `.local/body-temporal-20261018/manual-empty-runtime/isolated-render.json` 和 `comparison.json`。

本机原生库版本：`libcccreator.dylib` SHA-256 `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。原版库、原始 shader、反编译文本和探针副本只留在本地私有目录，没有进入产品源码。

## 代码和证据

- `research/independent-beauty/research/manual_body_zoom_geometry.py`：网格、UV、椭圆、径向权重和顶点打包，全部自写数值代码。
- `research/independent-beauty/research/manual_body_render.py`：zoom 改为正向网格；零强度直接保留输入；透明网格空白区域合成回原图。
- `body_mesh_renderer.py` / `body_mesh_metal.swift`：只有显式 `manual-zoom` profile 可以使用 63,001 顶点、125,000 三角形，而且必须使用 float 纹理采样；默认 body profile 保留 4096 上限和 half 采样。Python 和 Swift 都检查预算、有限数及索引。
- `tests/test_manual_body_zoom_geometry.py`：原生数值/网格摘要回归、越界及退化区域、预算和采样策略。
- `.local/body-temporal-20261018/manual-zoom-rea/index.html`：可浏览原图、原生、自研和 ×32 差分。
- 同目录 `production-image-report.json`、`zoom-leaf-report.json`、`zoom-mesh-report.json`、`zoom-fullgrid-report.json`、`smart-regression/report.json`：原始度量。

尚余的图片差异是极少数像素的 1 色阶，未用经验偏移或色值补丁掩盖。手动瘦身的实测场、拉长的全图采样以及视频时序、取消、恢复和导出验收仍是各自独立的工作项。
