# Playwright E2E 测试占屏幕问题 — 解决方案

Playwright E2E 测试会弹出浏览器窗口占屏幕，以下是几个方案从轻到重：

## 1. Headless 模式（最简单 ✅ 推荐先试）

```
npx playwright test --headed  # ← 你现在用的，会弹窗
npx playwright test           # ← 默认 headless，不弹窗
```

Playwright 默认就是 headless 的，不会占屏幕。如果你的配置里写了 `headless: false`，改成 `true` 或删掉就行。

## 2. 虚拟桌面（Windows 自带，零成本）

- `Win + Ctrl + D` 新建虚拟桌面
- 让 Playwright 在第二个桌面跑，你在第一个桌面工作
- `Win + Ctrl + 左/右` 切换桌面

## 3. WSL + Xvfb（Linux 虚拟显示）

在 WSL 里跑 Playwright，用 `xvfb-run` 虚拟一个屏幕：

```bash
# 安装
sudo apt install xvfb

# 运行（虚拟 1920x1080 屏幕）
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" npx playwright test
```

不会在你的真实屏幕上弹任何窗口。

## 4. Docker 容器（完全隔离）

```bash
# Playwright 官方 Docker 镜像
docker run --rm -v $(pwd):/work -w /work mcr.microsoft.com/playwright:v1.58.0-jammy \
  npx playwright test
```

完全隔离，不影响宿主机。

## 5. 自动虚拟显示系统（跨平台，推荐 ✅）

QCut 需要完整 GUI 渲染（Canvas、屏幕录制、Remotion 预览、视频解码），headless 模式不够用。

我们设计了一个跨平台虚拟显示系统，一个脚本自动检测平台并选择最佳策略：

- **Windows**: Virtual Desktop API — 在新虚拟桌面运行 Electron，用户桌面不受影响
- **macOS**: CGVirtualDisplay（macOS 14+）— 创建虚拟显示器，或回退到屏幕外窗口
- **Linux/CI**: xvfb-run — 标准 CI 方案，虚拟 X11 帧缓冲

```bash
# 在虚拟显示中运行 E2E 测试（不抢焦点）
bun run test:e2e:bg

# 传递参数给 Playwright
bun run test:e2e:bg -- --grep "timeline"
```

详细实现计划见 → [E2E Virtual Display Plan](./e2e-virtual-display-plan.md)

## 推荐

- **开发时**: 方案 5（虚拟显示）或方案 2（虚拟桌面手动切换）
- **CI/CD**: 方案 5（自动虚拟显示，跨平台）
- **需要看到界面调试**: 方案 2（虚拟桌面）
- **完全不想被打扰**: 方案 5（虚拟显示）或方案 3（Xvfb）或方案 4（Docker）
