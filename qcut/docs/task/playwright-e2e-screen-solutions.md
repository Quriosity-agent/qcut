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

## 推荐

- **开发时**: 方案 1（headless）或方案 2（虚拟桌面）
- **CI/CD**: 方案 1（headless，默认行为）
- **需要看到界面调试**: 方案 2（虚拟桌面）
- **完全不想被打扰**: 方案 3（Xvfb）或方案 4（Docker）
