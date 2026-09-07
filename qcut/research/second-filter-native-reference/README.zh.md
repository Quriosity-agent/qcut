# 第二张复杂滤镜的隔离原生参考

本目录只包含自有 Python runner 和测试。它编译既有 `filter-host-main.mm` 与宿主支持源码，在独立子进程中调用真实 Swing/FeatureSegment；厂商包、库、图像和运行日志保存在仓库外。

本轮固定卡为**迷雾**，资源 `7160594413847203085`、版本 `e745e131cff1db913aea07f4098ec8de`。原始包 41 个文件的 tree SHA256 为 `d2557b6359b86a8305e8da48f01f84af69827009a3b4ade94d79262b54168345`。运行前后检查包哈希；D634 core 的完整 SHA256 与 arm64 UUID 必须符合 runner 的固定身份。不是任意版本兼容声明。

## 参数与帧协议

自有 RGBA8 文件保持 top-down、四通道；时间传非负秒，既有宿主按 `llround(seconds*1e6)` 转换为整数微秒。每个请求内部执行两次 seek：首个成功 seek 后通过真实 `setSegmentParams` 提交 JSON，随后再渲染输出。请求不通过额外图像混合模拟强度。

```text
render<TAB>id<TAB>seconds<TAB>input.rgba<TAB>output.rgba<TAB>{"intensity":0.37}
exit
```

同一 child 支持相同尺寸下的任意时间顺序与强度变化。runner 要求 `READY`、按顺序且完整的成功 `RESULT`、成功参数提交、完整帧字节数；Lua onEvent/onStart/onUpdate 错误不会被 API 返回 0 掩盖。

已有低层 CGL composer 在这张原包上的 0/0.37/1 小样本全部输出默认画面，虽然 API 返回 0，Lua 第60行却收到 string 并算术报错。因此它被排除为本轮强度参考。也没有使用 `package-preparer.ts` 修改 Lua 副本的路径。

## 当前验证

三张自产图样分别为 chart 320×180、offaxis 257×145、threshold 321×181，覆盖非对称空间图案、奇数尺寸和 luminance 阈值两侧的 127/128 灰度。每张执行 0、0.37、0.5、1 四档真实参数，时间序列为 `0, 1/30, .125, 1, 2, .125, 0` 及其逆序，每档两个独立进程。另在同一 child 切换强度，再与 fresh child 结果比较。

30 个独立子进程、210 个可见输出请求通过：固定强度的全部时间、顺逆序和跨进程结果逐字节相同；强度切换结果与各自 fresh child 相同；0 强度精确等于原图。这里对应420次内部 seek，不把它们计作420个独立参考帧。

最终 CLI 再执行同一完整矩阵，12个参考及输入 SHA 与首轮一致。每张图的四档输出必须全部不同；“所有请求都返回原图”或两档误返回同一图都会失败。把0.37/0.5错误实现为强度1终图混合的六组负控制全部产生像素差异，因此它们没有被当作真实参数参考。八组可移植 runner 测试覆盖协议完整性/顺序、错误状态、Lua错误、非法参数/路径、像素长度、包变化、阈值图样，以及全部identity/部分强度碰撞负控制。

全部输入不透明，210个输出的 alpha 都为255。这个结果不扩展到透明/HDR、模型时序、实际 UI 事件调度或产品导出。本轮原生参考不能替代纯 C++ 差分验收；独立算法与误差结论由 `independent-fog-contract` 单独记录。

## 复现

从 QCut package 目录执行；目标目录必须不存在且位于仓库外：

```sh
python3 research/second-filter-native-reference/runner.py \
  --runtime '/Users/peter/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current' \
  --package '/Users/peter/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Cache/artistEffect/7160594413847203085/e745e131cff1db913aea07f4098ec8de' \
  --package-sha256 d2557b6359b86a8305e8da48f01f84af69827009a3b4ade94d79262b54168345 \
  --output /tmp/qcut-fog-native-reference-new
python3 -m unittest discover -s research/second-filter-native-reference -p 'runner_test.py' -v
```

`manifest.json` 保存 package/source/host 哈希、全部参考路径、输入和输出哈希与稳定性结论。每个 session 保存完整 argv、显式环境、raw协议、stdout/stderr和结果。`execution_runner_sha256` 保留实际生成帧的脚本身份，`validation_runner_sha256` 记录后续更严格验证器；新增强度区分门禁后，逐文件重读已有210帧并复核协议，没有伪称重新渲染。运行时相关 `DYLD_`/`JY_`/`QCUT_` 环境先清除，再仅设置私有 Frameworks 与帧尺寸；没有 app injection、真实 draft 修改或修改厂商包。

私有证据在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/second-filter-native/`，`pilot` 保留被否定的 CGL 路径及成功 Swing 小样本，`matrix` 与 `matrix-final` 分别保存完整210帧，后者为最终CLI采集批，随后由加强门禁的脚本重新验证。LUT 原 PNG 解码到512×512 RGBA8、未翻行的 SHA256 为 `6fbe77f1043a2f1e221e97bebdf1c569d3658c5bc30c3c98719a72e4c50ff295`；原生 package 直接读取原 PNG，解码副本仅供独立 C++ 差分。

另一次只对本诊断 child 加载既有 CGL observer、在预热后开启 gate 的实验得到0个 draw，终图与无observer逐字节一致。这是未取得中间Pass的结果，不把Soft Glow的13阶段profile套到本图，也不声称原生中间精度已经验证。正式矩阵均未加载observer。
