# 第二条完整 C++ 复杂滤镜：迷雾语义核验

本轮选择 **迷雾 `7160594413847203085` / `e745e131cff1db913aea07f4098ec8de`**。它包含阈值遮罩、两次 17 点加权采样、遮罩驱动的 Screen 合成和 LUT，不是纯 LUT 改名。本页记录原始包的静态合同与独立宿主事件证据；标准 C++ 实现、误差门禁及完整回归由 [independent-fog-contract](../../../research/independent-fog-contract/) 单独交付。

算法链闭合、特定宿主像素误差通过、剪映 UI 一致和产品接入是四个不同结论。本页不把历史 Metal 对照升级成新 C++ 的像素结论，也不把本次 Swing 参考称为本轮剪映 UI 导出。

## 选择依据与原始包边界

候选只检查了已知的五张卡，没有重扫全部库存：

| 卡 | 资源 ID | 本轮确认的额外边界 |
| --- | --- | --- |
| 旧乐园 | `7239977329668263227` | 多 prefab 图，尚未展开全部有效参数 |
| KV5D | `7127578859217620254` | 时间递增驱动 Noise，另有工作尺寸调整和 `setInt` 参数转换 |
| 沙砾 | `7160580722774920461` | 边缘、软化、锐化、辉光组成较大多段图，顶层 feature 事件还需独立核实 |
| 黑胶唱片 | `7221805176410180921` | 单独 Noise 脚本接收 `uTime`；脚本自身没有递增时钟，不能仅凭 uniform 名称宣称动画已生效 |
| 热气腾腾 | `7463372376038755603` | 带动画序列组件和对应资产 |

迷雾有明确的四阶段图、简单数值事件和已有原创 Metal 实现，适合优先完成一条可验证的标准 C++ 链。其他候选仍保留，未判定为不可实现。

读取的原始路径为：

```text
/Users/peter/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Cache/artistEffect/7160594413847203085/e745e131cff1db913aea07f4098ec8de
```

原始包共 **41 个文件**，已经逐项计算大小和 SHA-256。私有副本、完整序列化结果与清单位于：

```text
/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/second-filter-semantics/
  fog-vendor-package/
  package-manifest.private.json
  all-serialized.private.json
  serialized-compact.private.json
  lut-metadata.private.json
  semantics.private.json
```

`config.json` 只连接 `AmazingFeature/`；根及子目录的 `algorithmConfig.json` 声明一个 blit 节点，没有 NN、分割或检测节点。四段图只依赖输入图、包内 PNG 和场景/材质。厂商脚本、shader、场景、LUT 及序列化全文留在私有目录，本页只记录自产语义说明。

## 有效图与初值

序列化定位使用 `AmazingFeature/main.scene` 的 `Scene.entities[name=…]` 和各材质 `properties.texmap/floatmap/intmap`；这些二进制文件用文件哈希和属性定位，不编造文本行号。

| 次序 | 实体 / 相机 | 输入绑定 | 输出 |
| --- | --- | --- | --- |
| 1 | `Pass0` / `CameraPass0` | `inputImageTexture=share://input.texture` | `rt/midRenderTex0.rt` |
| 2 | `Pass1` / `CameraPass1` | `inputImageTexture=rt/midRenderTex0.rt` | `rt/midRenderTex1.rt` |
| 3 | `SeekModeScript` / `CameraPass2` | 原始输入及 `blurImageTexture=rt/midRenderTex1.rt` | `rt/NewScreenRT.rt` |
| 4 | `filter` / `Camerafilter` | `rt/NewScreenRT.rt` 及 `image/filter.png` | `rt/outputTex.rt` |

相机保存的 `renderOrder` 是 **1、2、3、3**，不是 1、2、3、4。网格的 `sortingOrder` 是 0、1、2、3，层分别为 0、1、2、3。上表顺序来自材质读写依赖和场景布局；最后两个相机的同值顺序仍需要实际渲染验证，不能靠改写排序数字解释。

| 参数 | 原始材质初值 | 收到数值强度 `t` 后 |
| --- | --- | --- |
| Pass0 / Pass1 `blurSize` | 2 | `(t × 0.90) × 4` |
| Pass0 / Pass1 `inputWidth/Height` | 720 / 1280 | 首次或尺寸变化时读取实际输入尺寸 |
| Pass2 `intensity` | 0.3149999976158142 | `1 − t × 0.50` |
| filter `intensity` | 1 | `t` |

**原始初值不等于强度 100%。** `t=1` 应得到 blurSize 3.6、Pass2 权重 0.5、LUT 权重 1。没有成功事件的默认输出不能用作 100% oracle。

三个中间目标都是 `ScreenRenderTexture`，`width/height=0`、`pecentX/pecentY=1`、`internalFormat=colorFormat=43`。这表明它们按屏幕全尺寸创建，未声明低分辨率模糊目标。`outputTex` 是 `SceneOutputRT`，`internalFormat=43`，但 `colorFormat=0`；两字段不能统一抄成 43。

所有四个 RT 保存：`dataType=1`、`filterMin=filterMag=1`、`wrapModeS/T/R=1`、`enableMipmap=false`、`filterMipmap=0`、`maxAnisotropy=1`、`massMode=0`。已恢复的 [AGFX 合同](../../../research/independent-agfx-contract/README.zh.md)把本机 11.3 的格式 43 映射为 RGBA8Unorm、filter 1 映射为 linear、wrap 1 映射为 clamp-to-edge。该映射支持 CPU 工作模型，但与 D634 Swing 的实际附件/采样状态是不同证据，不能当成同一次 Metal 执行轨迹。

各 xshader 只显式保存 depth/stencil 状态，没有显式 blend 记录。缺少序列化字段本身不证明运行时一定关闭 blending。每阶段 RGBA8 写回与边界采样的最终精度由实际像素对照确认。

## 生命周期、强度与时间

原始 `AmazingFeature/lua/SeekModeScript.lua`：

- 9–13 行设定 `startTime=0`、`endTime=3`、`curTime=0` 和未初始化尺寸。
- 31–36 行 `onStart` 获取四个材质，不写入滤镜强度。
- 21–29 行每次更新调用 seek，但没有递增 `curTime`。
- 38–54 行 seek 只刷新宽高；传入的 `time` 不参与图像公式，动画调用是注释。
- 57–71 行仅当第一个事件参数等于 `intensity` 时，第二参数驱动四个 uniform。60 行更新 Pass2；64–65 行更新两个 blur；69 行更新 LUT。

61–68 行附近的替代事件分支和 `×0.60` 全部位于注释中，不会结束现有 `if` 或形成额外事件处理。数值事件没有自身 clamp。独立 C++ 选择拒绝非有限值和 `[0,1]` 外强度，是公开输入边界，不是声称原脚本进行了同样校验。

表达式遵循 Lua 数值计算后再 `setFloat`：保留 `(t × 0.90) × 4` 的左结合次序以及 `1 − (t × 0.50)`，最后窄化到材质 float。直接在 float 中先算 `3.6F × t` 不能当作逐位等价。事件必须在 `onStart` 取得材质后生效；只记录 API 返回码不够。

本包没有时间 uniform、噪声函数或实际读取时间的图像公式。给定相同输入、尺寸和四个 uniform，静态语义是逐帧无历史依赖。宿主事件递送、尺寸变化和重复帧稳定性仍分别测试，不能仅由此静态结论省略。

## 四阶段可实现规格

以下数学使用归一化 RGBA。纹理采样先按坐标取得双线性结果，阶段结束写回中间纹理。GLSL 前两段声明 `lowp`，后两段声明 `highp`；本包生成的 Metal 使用 float。限定符不是跨驱动逐位算术保证，FMA、插值权重和 UNORM 量化仍需 oracle 判定。

### 1. 横向采样并构造遮罩

位置中心为像素中心。横向步长为 `(blurSize / inputWidth) × 1.25`。取中心以及左右各 8 点，共 17 taps；半边权重依次是：

```text
距离 0..8：0.20, 0.19, 0.17, 0.15, 0.13, 0.11, 0.08, 0.05, 0.02
```

对**每一次采样后的 RGB**计算亮度 `0.299R + 0.587G + 0.114B`：大于 0.5 时把该 sample 的 alpha 替换为 0，否则替换为 1。等于 0.5 属于 1。先把整张离散图阈值化、再双线性采样遮罩，会在阈值边缘得到不同结果。

累积顺序是：中心项单独保存；从距离 1 到 8，先正方向加权项，再负方向加权项；最后加中心并除以权重和。分母从中心权重开始，逐步加两倍旁侧权重。数学和为 2，但浮点累计过程应保留，不能以此删除运算。

证据：`shaders/pass0-0-562e/gles2/49d8.frag` 9–15、24–36、39–63 行。

### 2. 纵向加权采样

以第一段 RGBA 结果为输入，纵向步长为 `(blurSize / inputHeight) × 1.25`，同样 17 taps、权重和累加次序。此段**不重新计算阈值**，alpha 是第一段遮罩经过纵向滤波的结果。

证据：`shaders/pass1-0-30d1/gles2/c93c.frag` 的 main 中权重、纵向坐标和结果写回。

### 3. 遮罩驱动的雾化合成

令原始颜色为 `C`，纵向模糊颜色为 `B`，Pass2 uniform 为 `q=1−0.5t`。RGB 运算为：

1. `m = B.a × 0.457`，随后把参与合成的 `B.a` 设为 1。
2. `R = mix(C, B, 1−m)`。
3. `S = 1−(1−C)×(1−R)`，即逐通道 Screen。
4. `R = mix(S, R, 0.25)`。
5. `R = mix(R, C, q)`。
6. alpha 恢复为原始 `C.a`，随后**整个 RGBA**限制到 `[0,C.a]`。

没有 Normal 层对象、额外 opacity 或 host output-mix。这里的 `q` 是保留原始图权重，所以事件强度增大时它下降。GLSL `mix` 表达式对应的 C++ 求值次序和驱动优化不能仅凭数学等式认定逐位相同。

证据：`shaders/pass2-0-a3a6/gles2/c335.frag` 6–11、16–31 行。

### 4. 64³ LUT 的 512×512 图集

使用 8×8 个 tile，每个 tile 为 64×64。蓝色值乘 63，分别取 floor/ceil 所在 tile；tile 行为 `floor(slice/8)`，列为 `slice−8×row`。tile 内坐标使用红/绿，并包含半 texel 偏移：

```text
u = column / 8 + 0.5 / 512 + (1 / 8 − 1 / 512) × R
v = row    / 8 + 0.5 / 512 + (1 / 8 − 1 / 512) × G
```

对两个 tile 做纹理采样，用蓝色小数部分混合，再按 `t` 与第三段图像混合。PNG alpha 被忽略，输出 alpha 保留输入；形式参数 `uniAlpha` 没有参与计算。该段没有解预乘，也没有再次执行 `RGB≤alpha` 限制。

因此不透明输入时 `t=0` 应恢复输入；对非预乘的透明输入，第三段 clamp 可能在零强度改变 RGB，而 LUT 又可能使 RGB 超过 alpha。本轮完整管线先限定不透明 RGBA8，不能把零强度直通结论推广到任意透明表示。

证据：`shaders/filter-0-d696/gles2/1fa0.frag` 9–35、38–42 行。

## LUT 方向与资产语义

`image/filter.png` 是 512×512。它的 `PngMeta`：

| 属性 | 值 |
| --- | --- |
| `innerAlphaPremul` / `outerAlphaPremul` | false / false |
| `isColorTexture` | false |
| `needFlipY` | false |
| `enableMipmap` | false |
| `filterMin` / `filterMag` | 1 / 1 |
| `wrapModeS/T/R` | 1 / 1 / 1 |

`quad.mesh` 是 20 字节 stride 的 position xyz + UV，position offset 0、UV offset 12。四个顶点依次为：clip `(-1,-1)` 对应 `(0,0)`、`(1,-1)` 对应 `(1,0)`、`(1,1)` 对应 `(1,1)`、`(-1,1)` 对应 `(0,1)`。四个 index 为 0、1、2、3。

四段顶点 shader 都传递原始 UV。LUT 的 vertex 另计算一个翻转后的 `uv1`，但 fragment **只读取 `uv0`**；不能把未使用的 varying 当作实际 Y 翻转。生成的 Metal vertex 只额外调整 clip Z，未改写 UV。

独立输入约定采用 PNG 解码的 top-down 紧凑 RGBA8，不做额外 LUT 翻转或颜色空间变换。该约定与元数据一致；实际 raw 输入/读回的行方向还由不对称原生图像对照覆盖。

私有已解码 LUT：

```text
/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/second-filter-native/pilot/filter-512x512.rgba
SHA-256 6fbe77f1043a2f1e221e97bebdf1c569d3658c5bc30c3c98719a72e4c50ff295
```

## 原始事件与历史 prepared-package 的区别

现有 [package-preparer.ts](../../../electron/jianying-filter-local-runtime/package-preparer.ts) 的迷雾 profile 是 `script-bootstrap`：校验精确版本和 Lua 哈希后，在**复制的脚本** `onStart` 内添加四个 uniform 赋值。它可以用于既有适配器，但这类历史参考不能证明原始包的真实 `onEvent` 接到了数值参数。

本次独立原生试验保留了失败通道：CGL composer 的三个强度输出相同，并在原脚本第 60 行报告强度类型为 string。该调用不能作为强度 oracle。随后使用隔离 Swing 宿主的 JSON 数值参数，原始包未被改动：320×180 chart 的 `t=0/0.37/1` 各连续 9 帧稳定，三档输出不同，零档与输入逐字节相同。

这些初步输出的命令、输入/输出哈希、host/core 哈希记录在：

```text
/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/second-filter-native/pilot/manifest.json
/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/second-filter-native/pilot/cgl-0.37/stderr.log
```

小样本之后，`second-filter-native/matrix-final/manifest.json` 保存了三张自产图（320×180、257×145、321×181）、0/0.37/0.5/1 四档的完整矩阵：30 个独立子进程、210 个输出请求。固定强度的不同时间、逆序和跨进程输出逐字节相同；同一 child 改变强度的输出与 fresh child 一致；每张图四档输出各异，零档精确等于输入，全部 alpha 为 255。每请求内部两次 seek，不把它们计作 420 个独立参考输出。

只检查稳定性和零档直通仍可能放过“所有档都返回原图”。审查后新增四档哈希各异门禁和全原图/部分档碰撞负控，八组 runner 测试通过；已逐帧重新读取原有 210 帧，未重新渲染。manifest 分别保存实际采集时的 `execution_runner_sha256` 和加强验证后的 `validation_runner_sha256`，没有覆盖历史采集身份。

上述矩阵确认数值事件和静态图像的时间/调用顺序边界，仍不覆盖连续移动图像、任意强度、透明输入或本轮 UI 导出。一次隔离 child 中间 draw 观测实验没有取得有效 Pass，不能据此宣称 RT 的实际 GPU 状态已经捕获。C++ 像素差分独立记录误差范围。参考宿主固定 D634 私有运行时；本机安装版 AGFX 枚举研究单独标识，不混用二进制身份。

## 精确证据索引

下表路径相对包根；完整 41 文件清单在私有 manifest。文本依据使用上文真实行号，二进制依据使用上文 entity/property locator。

| 相对路径 | SHA-256 |
| --- | --- |
| `config.json` | `0235936f7d8f6685f9f1fcb2137242e86c4f81349f01b3bf99b8c873a62c05df` |
| `algorithmConfig.json` | `b24c362513af66c9a7343084c3c82f978017fab48a19dcb764aaa034bd4f6ab3` |
| `AmazingFeature/main.scene` | `a2da8e318e91b3c2d436605f7883d704f309916467e87454b34fc8afac6e63cd` |
| `AmazingFeature/lua/SeekModeScript.lua` | `3e31309e74c274703ba5ef68c095fb1808ebbf502e2dc4ea599a69e9b6e75270` |
| `AmazingFeature/mesh/quad.mesh` | `2d77d5a01f0938ad7b1e2cb7f3aa382b1af0c04d592eb9cdca7bf61c6d7f0d07` |
| `AmazingFeature/image/filter.png` | `e3d93009c983c84a674e5d288d8d3fbdd8f3e9572f9687132cc03bd4e14976d8` |
| `AmazingFeature/image/filter.png.meta` | `a03836dc6991c85909ef81a3fff7fb06f8b318875caf0481289e30436195108a` |
| `AmazingFeature/shaders/pass0-0-562e/gles2/49d8.frag` | `9da448263e02c7161c4d9185fd7d2a4178b144d7563da94a053e4e87c661e003` |
| `AmazingFeature/shaders/pass1-0-30d1/gles2/c93c.frag` | `1a072f8f818dcc67f4e1f59464f12161517ba33662827f56ab4b8d68a0488fea` |
| `AmazingFeature/shaders/pass2-0-a3a6/gles2/c335.frag` | `32ebc9b27a04e75ec92087b1f598595859a7abce043952474268bf540c603d6a` |
| `AmazingFeature/shaders/filter-0-d696/gles2/1fa0.frag` | `65e6abb339f81250a8228e85e03b9ed69c5002730f5faeda7156f1073900bfa5` |

本页没有把 LUT 像素、厂商源码、原始字节或 shader 译文带入仓库。独立实现仍需外部提供并校验精确 LUT，算法源码可独立编译与运行测试，素材授权与打包归属不由此页改变。
