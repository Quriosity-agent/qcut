# README.md 过时内容分析与修复任务

> 生成日期: 2026-02-04
> 分析对象: `qcut/README.md`

---

## 概述

经过对比README.md与实际项目状态（package.json、目录结构、代码），发现以下过时内容需要更新。

---

## 1. 标题与描述 - 平台支持

### 问题
README标题写的是 **"A free, open-source video editor for Windows desktop (and web)"**，但项目现在已经支持 **macOS** 和 **Linux**。

### 证据
- `package.json` 包含 `dist:mac`, `dist:linux`, `dist:all` 脚本
- `build` 配置中有完整的 `mac` 和 `linux` 配置

### 修复任务
- [ ] **Task 1.1**: 更新标题为 "A free, open-source video editor for Windows, macOS, and Linux"
- [ ] **Task 1.2**: 更新 "Quick Start" 部分，不再仅限于 "(Windows Desktop App)"

---

## 2. Features 部分 - 缺少新功能

### 问题
Features列表缺少多个已实现的功能。

### 缺少的功能
1. **Terminal集成** - PTY handler已实现 (`pty-handler.ts`)
2. **Skills系统** - 自定义技能支持 (`skills-handler.ts`)
3. **Remotion集成** - 可编程视频渲染 (`remotion-*.ts` handlers)
4. **AI聊天** - Gemini聊天功能 (`gemini-chat-handler.ts`)
5. **ElevenLabs语音** - 语音转录 (`elevenlabs-transcribe-handler.ts`)
6. **媒体导入管理** - 高级媒体处理 (`media-import-handler.ts`)
7. **项目文件夹管理** - 项目组织 (`project-folder-handler.ts`)
8. **AI视频保存** - AI生成视频保存 (`ai-video-save-handler.ts`)
9. **AI Pipeline** - AI工作流管道 (`ai-pipeline-handler.ts`)

### 修复任务
- [ ] **Task 2.1**: 添加 "Terminal Integration" 到 Features 列表
- [ ] **Task 2.2**: 添加 "Skills System" 功能描述
- [ ] **Task 2.3**: 添加 "Remotion Integration" 用于可编程视频
- [ ] **Task 2.4**: 添加 "AI Chat" 功能 (Gemini)
- [ ] **Task 2.5**: 添加 "Multi-provider Transcription" (Gemini + ElevenLabs)
- [ ] **Task 2.6**: 添加 "AI Video Pipeline" 功能

---

## 3. Project Structure - electron目录结构过时

### 问题
README中的electron目录结构严重过时，只列出了部分handler。

### 当前README显示
```
electron/
├── main.ts
├── preload.ts
├── *-handler.ts            # All IPC handlers (TypeScript)
└── dist/
```

### 实际结构（需要更新）
```
electron/
├── main.ts
├── preload.ts
├── ai-pipeline-handler.ts
├── ai-video-save-handler.ts
├── api-key-handler.ts
├── audio-temp-handler.ts
├── binary-manager.ts
├── elevenlabs-transcribe-handler.ts
├── ffmpeg-handler.ts
├── gemini-chat-handler.ts
├── gemini-transcribe-handler.ts
├── media-import-handler.ts
├── project-folder-handler.ts
├── pty-handler.ts
├── remotion-bundler.ts
├── remotion-composition-parser.ts
├── remotion-folder-handler.ts
├── skills-handler.ts
├── sound-handler.ts
├── temp-manager.ts
├── theme-handler.ts
├── video-temp-handler.ts
├── claude/               # Claude AI integration
├── config/               # Configuration files
├── ffmpeg/               # FFmpeg binaries
├── resources/            # Resource files
└── types/                # TypeScript type definitions
```

### 修复任务
- [ ] **Task 3.1**: 更新 Project Structure 中的 electron 目录结构
- [ ] **Task 3.2**: 添加新的子目录说明 (claude/, config/, ffmpeg/, types/)

---

## 4. TypeScript Architecture - Handler数量错误

### 问题
README说 **"All 19 handlers converted"**，但实际handler数量已超过19个。

### 实际Handler列表 (21+)
1. ai-pipeline-handler.ts
2. ai-video-save-handler.ts
3. api-key-handler.ts
4. audio-temp-handler.ts
5. binary-manager.ts
6. elevenlabs-transcribe-handler.ts
7. ffmpeg-handler.ts
8. gemini-chat-handler.ts
9. gemini-transcribe-handler.ts
10. media-import-handler.ts
11. project-folder-handler.ts
12. pty-handler.ts
13. remotion-bundler.ts
14. remotion-composition-parser.ts
15. remotion-folder-handler.ts
16. skills-handler.ts
17. sound-handler.ts
18. temp-manager.ts
19. theme-handler.ts
20. video-temp-handler.ts
21. (main.ts 和 preload.ts 中的内联handlers)

### 修复任务
- [ ] **Task 4.1**: 更新handler数量描述（从"19"改为"20+"或具体数字）
- [ ] **Task 4.2**: 更新 "Fully Converted Components" 列表，添加缺少的handlers
- [ ] **Task 4.3**: 移除 `transcribe-handler.ts`，改为 `elevenlabs-transcribe-handler.ts` 和 `gemini-transcribe-handler.ts`

---

## 5. Available Scripts - 缺少跨平台构建脚本

### 问题
README的 "Available Scripts" 部分缺少跨平台构建脚本。

### 缺少的脚本
```bash
bun run dist:mac      # Build macOS installer
bun run dist:linux    # Build Linux installer (AppImage/deb)
bun run dist:all      # Build for all platforms
```

### 修复任务
- [ ] **Task 5.1**: 添加 `dist:mac`, `dist:linux`, `dist:all` 到 Available Scripts
- [ ] **Task 5.2**: 添加 E2E 测试脚本说明 (`test:e2e`, `test:e2e:ui`)

---

## 6. Architecture版本号 - 需要验证/更新

### 问题
版本号可能略有不同（通常是minor版本）。

### 当前README vs 实际
| 组件 | README | 实际 |
|------|--------|------|
| Vite | 7 | 7.1.3 |
| Tailwind CSS | 4 | 4.1.12 |
| Electron | 37.4.0 | 37.4.0 ✓ |
| React | 18.3.1 | 18.3.1 ✓ |

### 修复任务
- [ ] **Task 6.1**: 考虑是否更新为更精确的版本号（可选，minor版本差异可接受）

---

## 7. Desktop-Only Features - 不完整

### 问题
Desktop-Only Features列表不完整。

### 缺少的功能
- **Terminal** - 内置终端功能
- **Skills执行** - 自定义skill脚本运行
- **Remotion渲染** - 可编程视频导出
- **AI Chat** - Gemini聊天集成
- **项目文件夹** - 原生项目文件管理

### 修复任务
- [ ] **Task 7.1**: 添加 "Terminal Integration" 到 Desktop-Only Features
- [ ] **Task 7.2**: 添加 "Skills System" 到 Desktop-Only Features
- [ ] **Task 7.3**: 添加 "Remotion Rendering" 到 Desktop-Only Features
- [ ] **Task 7.4**: 添加 "AI Chat (Gemini)" 到 Desktop-Only Features

---

## 8. Building for Distribution - 缺少跨平台说明

### 问题
只提到Windows构建，缺少macOS和Linux说明。

### 修复任务
- [ ] **Task 8.1**: 添加 macOS 构建说明
- [ ] **Task 8.2**: 添加 Linux 构建说明
- [ ] **Task 8.3**: 添加跨平台构建一次性命令说明

---

## 9. Troubleshooting - 可能需要更新

### 建议新增的故障排除项
- macOS权限问题
- Linux依赖问题
- FFmpeg二进制下载失败处理
- Skills执行问题

### 修复任务
- [ ] **Task 9.1**: 添加 macOS 特定的故障排除
- [ ] **Task 9.2**: 添加 Linux 特定的故障排除
- [ ] **Task 9.3**: 添加 Skills系统故障排除

---

## 执行优先级

### 高优先级（影响用户体验）
1. Task 1.1, 1.2 - 平台支持描述
2. Task 3.1, 3.2 - 项目结构
3. Task 5.1, 5.2 - 构建脚本
4. Task 8.1, 8.2, 8.3 - 跨平台构建说明

### 中优先级（功能完整性）
1. Task 2.x - Features列表更新
2. Task 4.x - Handler列表更新
3. Task 7.x - Desktop-Only Features

### 低优先级（细节完善）
1. Task 6.1 - 版本号精确化
2. Task 9.x - Troubleshooting扩展

---

## 快速修复清单

```markdown
□ 更新标题: Windows → Windows/macOS/Linux
□ 更新Quick Start标题
□ 添加新功能: Terminal, Skills, Remotion, AI Chat
□ 更新electron目录结构
□ 修正handler数量 (19 → 20+)
□ 添加跨平台构建脚本说明
□ 添加macOS/Linux构建说明
□ 更新Desktop-Only Features列表
□ 添加跨平台Troubleshooting
```

---

## 备注

此文档基于以下文件分析生成：
- `qcut/README.md`
- `qcut/package.json`
- `qcut/apps/web/package.json`
- `qcut/electron/` 目录结构
