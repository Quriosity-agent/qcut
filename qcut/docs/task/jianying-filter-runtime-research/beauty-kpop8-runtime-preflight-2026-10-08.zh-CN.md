# Beauty 8：外置资源预检闭环

上一轮真实窗口验收发现外置目录漏了 Cache 时，自研仍显示就绪，点击处理才在美白阶段报错。本轮把资源预检接到自研 provider 的 inspect 和每次渲染前置校验，让缺文件／损坏在出图前明确拒绝。原生路径继续调用原有 provider；没有 fallback。

## 固定安装配置与校验

`electron/beauty-lab-runtime-payload.json` 保存本机已验证外置安装配置的 358 个相对路径、字节数和 SHA-256，共 68,134,182 字节，绑定独立源码 manifest `27728858fe1687c540657977bc31a570146dbdd0e789448f142a10569b9a2750`。清单覆盖 catalog 渲染器的传递依赖、固定／动态命名模型与素材、五个肤色 mask profile、FlowGAN／SpotAcne 模型及私有导出数据、16 个引用素材包和 FlowGAN mask。记录元数据；模型、素材、提取表和库内容均留在本地。素材包按完整安装配置校验，未提供按请求裁剪的部分安装支持。

清单只包含 research、Cache 和 Models。原生 Frameworks 参与提取的历史不构成自研渲染依赖，因此不将原生库列为必装项。生成宿主、实验文件及原生库均未列入配置。清单更新需同时审查源码身份及安装资源，不能用任意本机文件自动重建清单来绕过校验。

`beauty-lab-runtime-payload.ts` 校验配置版本、源码绑定、重复／越界路径、文件类型、精确大小和流式 SHA-256。最多四个并发文件句柄，读取限于声明长度，读完再次检查大小，finally 关闭句柄。允许外置目录链接，拒绝 payload 文件链接；接受合法空元数据文件。错误按路径排序，显示总数和前八项，不输出完整绝对文件系统路径。

provider 先验证源码，再执行 payload 校验及 Python／Bun 入口检查。失败返回 available=false，渲染不会派发 worker。每次重新检查资源，不依赖过期的成功缓存。模型／材质语义校验仍由渲染器执行。

## 可复跑 CLI 与真实资源验证

```sh
bun scripts/verify-independent-beauty-runtime.ts <external-runtime> research/independent-beauty
```

CLI 只做 payload 校验，要求源码 manifest 与固定 profile 匹配，输出文件数、字节数和耗时。它不运行 Python 或渲染，明确输出 pixelsRendered=false 和 pythonEnvironmentVerified=false。provider 另外验证全部固定源码，CLI 的 manifest 匹配不能替代源码完整性检查。

隔离目录位于工作树 `.local/jianying-parity/runtime-preflight-r1/`，原始运行库保持不变：

| 安装情况 | 结果 |
| --- | --- |
| 完整 research／Cache／Models，完全没有 Frameworks | 358 项哈希通过；一次实测 55.8 ms |
| 缺 Cache | 303 项缺失，CLI 非零退出，真实 provider unavailable |
| alignment-assets-v1.npz 同长度全零替换 | 精确定位该文件 SHA-256 损坏，CLI 非零退出，真实 provider unavailable |
| 无 Frameworks 的完整配置执行真实自研复合处理 | 成功，输出 SHA 与上一轮完全一致 |

实际复合参数为美白 45、瘦脸 35、瘦鼻 25、珊瑚裸粉口红 40，真人照片 240×320。独立-only 配置仅链接既有模型／素材／Python，没有 Frameworks 目录；真实自研 provider 成功，RGBA SHA 为 `fa61940f10af88ed408e83aeb6c547ee29edc7ab2fab4509f36e5e5e0316fa0a`。开发双路照片探针也通过：零参数原图恒等，非零两路实际改变图片，原生／自研最大 RGB 差 1、31 个变化像素，MAE 0.0001475694。此轮未修改像素算法。

资源 preflight 和 provider／IPC／序列回归测试纳入既有 Electron CI 目录门禁；覆盖缺失、截短、同尺寸损坏、目录占位、空元数据、路径越界／重复、源码 profile 不匹配、外置目录链接、文件链接及错误数量限制。

## 签名包与回归

本机 QA 包 `.local/beauty-runtime-package-r2/mac-arm64/QCut AI Video Editor.app` 使用既有 Developer ID 与 Hardened Runtime，未 notarize。在该应用自己的 Electron Node 模式加载真实 ASAR provider：缺 Cache／同尺寸损坏均 unavailable，无 Frameworks 的完整配置成功渲染同一复合照片，输出 SHA 与开发和上一轮一致。严格整包签名在处理前后通过。

通过 CUA 启动该包，打开此前的隔离测试项目，进入美颜实验室，导入照片并分别点击原生／自研处理。两个实际结果和差异面板均出现：31 个变化像素，RGB 最大差 1，alpha 最大差 0。新窗口截图保存在本地证据目录 `beauty-lab-signed.png`；`packaged-receipt.json` 区分包内模块与实际窗口验收。无 Frameworks 的测试限于包内 Node 模式；窗口使用本机默认完整外置目录。

运行后 262 个固定源码哈希全部通过，资源目录仍精确 263 文件。Electron 构建、全库类型、CLI 严格类型、来源规则及本轮文件 Biome 检查通过。六个核心回归文件共 135 项通过，前端自研状态 hook 另 14 项通过，合计 149 项；未与历史批次相加。

## 边界

这是固定外置 payload 完整性及独立性验收。新机器安装器、Python 包与工具链能力预检、notarization 仍未实现或验收；全量照片的 19 项残差、视频接入时间线／最终导出、跟踪／遮挡／多人仍未解决。不能将清单通过或一个复合样本通过称为全产品原生等价。
