# Claude Code 自动修复 Qcut 错误探索

## 概念

探索是否可以让 Claude Code 在用户运行 Qcut 时自动检测并修复错误。

---

## 🔍 Qcut 当前架构分析

### 已有的相关功能

#### 1. Skills 系统 (`electron/skills-handler.ts`)
- **运行时加载 Markdown 文件** - 不是编译到 binary 的！
- Skills 来源：
  - `resources/default-skills/` - 随 app 打包
  - `~/.claude/skills/` - 用户全局 skills
  - `Documents/QCut/Projects/{projectId}/skills/` - 项目特定 skills
- **关键点**: Skills 是可修改的，不是 binary

#### 2. PTY Handler (`electron/pty-handler.ts`)
- 已经有完整的终端集成
- 可以 spawn shell 进程
- 支持 `command` 参数运行特定命令
- **这意味着**: 可以直接运行 `claude` CLI！

#### 3. Gemini Chat 集成 (`electron/gemini-chat-handler.ts`)
- 已有 AI 聊天集成模式
- Streaming 响应
- 文件附件支持
- **参考模式**: Claude 集成可以类似实现

### 打包后什么是 Binary，什么可修改？

| 组件 | 打包后状态 | 可修改？ |
|------|-----------|---------|
| Electron 主进程 (`main.ts`) | 编译为 JS，打包在 asar | ❌ 不可修改 |
| 渲染进程 (React UI) | 编译为 JS bundle | ❌ 不可修改 |
| FFmpeg WASM | Binary | ❌ 不可修改 |
| **Skills (Markdown)** | 普通文件 | ✅ **可修改！** |
| **配置文件** | JSON 文件 | ✅ **可修改！** |
| **项目文件** | 用户数据 | ✅ **可修改！** |
| **API Keys** | 加密存储 | ✅ 可更新 |

---

## 💡 可行的 Claude Code 集成方案

### 方案 A: 开发者模式 (Development)

**场景**: 开发者使用 `bun run dev` 运行时

```
用户: bun run build 失败
  ↓
Claude Code (通过 PTY):
  1. 分析错误日志
  2. 检查 package.json, tsconfig.json
  3. 自动修复 (安装依赖, 修改配置)
  4. 重试 build
```

**实现方式**:
- 使用已有的 `pty-handler.ts`
- Spawn `claude` CLI 进程
- 传入错误上下文和项目路径

```typescript
// 概念代码 - 使用现有 PTY handler
const result = await window.electronAPI.pty.spawn({
  command: 'claude --print "分析这个错误并修复: [错误内容]"',
  cwd: projectPath,
  env: { ANTHROPIC_API_KEY: apiKey }
});
```

### 方案 B: 用户模式 (Production EXE)

**限制**: 源代码是 binary，无法修改

**但可以做的事情**:

1. **修复 Skill 文件**
   ```
   用户导入的 Skill 有语法错误
     ↓
   Claude Code 分析 Skill.md
     ↓
   修复 frontmatter 或内容
   ```

2. **修复项目配置**
   ```
   项目文件损坏或格式错误
     ↓
   Claude Code 分析 project.json
     ↓
   修复 JSON 结构
   ```

3. **生成新 Skills**
   ```
   用户描述需求
     ↓
   Claude Code 生成新 Skill
     ↓
   保存到 ~/.claude/skills/
   ```

4. **诊断错误 + 提供解决方案**
   ```
   运行时错误
     ↓
   Claude Code 分析错误
     ↓
   提供用户可执行的修复步骤
   ```

### 方案 C: 混合模式 (最佳)

```
┌─────────────────────────────────────────────────────────────┐
│                      用户遇到错误                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Error Boundary / 错误监听器 捕获错误                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  判断错误类型                                                │
│  ├─ Skill 相关 → Claude 可以直接修复                        │
│  ├─ 配置相关 → Claude 可以直接修复                          │
│  ├─ 项目文件 → Claude 可以尝试修复                          │
│  └─ 核心代码 → 生成 Issue + 临时解决方案                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  执行修复 / 显示建议                                         │
│  └─ 如果是开发模式: 可以修改源代码                          │
│  └─ 如果是生产模式: 修改可修改文件 + 显示手动步骤            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 具体实现计划

### Phase 1: Skill 错误自动修复 (最简单)

**为什么先做这个**:
- Skills 是纯 Markdown，易于修改
- 已有 skills-handler.ts 基础设施
- 用户经常会导入有问题的 skills

```typescript
// electron/claude-skill-fixer.ts

import { ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

interface SkillError {
  skillId: string;
  errorType: "frontmatter" | "syntax" | "missing_file";
  message: string;
}

export function setupClaudeSkillFixer(): void {
  ipcMain.handle(
    "claude:fix-skill",
    async (event, projectId: string, skillId: string, error: SkillError) => {
      const skillPath = getProjectSkillsPath(projectId);
      const skillMdPath = path.join(skillPath, skillId, "Skill.md");
      
      // 读取当前 skill 内容
      const content = await fs.readFile(skillMdPath, "utf-8");
      
      // 调用 Claude API 修复
      const fixedContent = await callClaudeToFix(content, error);
      
      // 写回修复后的内容
      await fs.writeFile(skillMdPath, fixedContent, "utf-8");
      
      return { success: true, fixedContent };
    }
  );
}

async function callClaudeToFix(content: string, error: SkillError): Promise<string> {
  // 使用 Anthropic API 或 Claude CLI
  // ...
}
```

### Phase 2: 开发模式 Build 错误修复

利用已有的 PTY handler:

```typescript
// 在开发模式下，当 build 失败时
async function handleBuildError(error: string, projectPath: string) {
  // 检查是否在开发模式
  if (!app.isPackaged) {
    // 使用 PTY 运行 Claude Code
    const ptyResult = await spawnClaudeFix({
      command: `claude --print "修复这个 build 错误:\n${error}"`,
      cwd: projectPath
    });
    
    // 解析 Claude 的修复建议
    // 自动应用或显示给开发者确认
  }
}
```

### Phase 3: 错误诊断 + Issue 生成

对于无法自动修复的错误:

```typescript
async function handleUnfixableError(error: Error, context: any) {
  // 收集错误上下文（不包含敏感数据）
  const errorReport = {
    message: error.message,
    stack: error.stack,
    version: app.getVersion(),
    platform: process.platform,
    // 不收集: 用户数据、API keys、文件内容
  };
  
  // 让 Claude 分析并生成用户友好的解释
  const analysis = await analyzeWithClaude(errorReport);
  
  // 显示给用户
  showErrorDialog({
    title: "出现错误",
    description: analysis.userFriendlyMessage,
    suggestion: analysis.suggestion,
    canAutoFix: false,
    reportButton: true // 一键生成 GitHub Issue
  });
}
```

---

## ⚠️ 重要限制和注意事项

### 生产环境 (EXE) 限制

1. **无法修改核心代码**: 打包后的 JS 在 asar 归档中
2. **无法热更新 UI**: 需要新版本发布
3. **Claude CLI 需要单独安装**: 用户需要有 Node.js 和 Claude CLI

### 安全考虑

1. **不泄露用户数据**: 只发送错误信息，不发送项目内容
2. **确认修改**: 重大修改前需用户确认
3. **备份**: 修改文件前自动备份
4. **沙盒**: Claude 只能访问特定目录

### 成本考虑

1. **API 调用**: 每次修复都有 API 成本
2. **缓存**: 缓存常见错误的解决方案
3. **本地优先**: 简单错误本地处理，复杂问题才调 API

---

## 📊 实现优先级

| 功能 | 难度 | 价值 | 优先级 |
|------|------|------|--------|
| Skill 文件修复 | 低 | 高 | ⭐⭐⭐ P0 |
| 错误诊断+建议 | 中 | 高 | ⭐⭐⭐ P0 |
| 开发模式 Build 修复 | 中 | 中 | ⭐⭐ P1 |
| 自动生成 GitHub Issue | 低 | 中 | ⭐⭐ P1 |
| 配置文件修复 | 低 | 低 | ⭐ P2 |
| 热修复核心代码 | 高 | 低 | ❌ 不推荐 |

---

## 下一步行动

- [x] 分析 Qcut 现有架构
- [x] 确认什么可以修改，什么是 binary
- [ ] 实现 Skill 错误检测和修复 (Phase 1)
- [ ] 添加错误诊断 UI 组件
- [ ] 集成 Claude API 或 CLI
- [ ] 测试开发模式下的 build 错误修复

---

---

## 🚀 扩展思路: Claude 友好的 API 层

> **核心想法**: 与其让 Claude 修改 binary，不如暴露更多结构化的接口让 Claude 操作！

### 需要暴露的 "端口"

#### 1. Media Folder Access (`claude:media`)

```typescript
// electron/claude-media-handler.ts

interface MediaAPI {
  // 列出项目中的所有媒体文件
  "claude:media:list": (projectId: string) => MediaFile[];
  
  // 获取媒体文件元数据
  "claude:media:info": (projectId: string, mediaId: string) => MediaMetadata;
  
  // 导入新媒体 (从 URL 或路径)
  "claude:media:import": (projectId: string, source: string) => MediaFile;
  
  // 删除媒体
  "claude:media:delete": (projectId: string, mediaId: string) => void;
  
  // 重命名/组织媒体
  "claude:media:rename": (projectId: string, mediaId: string, newName: string) => void;
}

interface MediaFile {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  path: string;
  duration?: number;
  dimensions?: { width: number; height: number };
  size: number;
  createdAt: number;
}
```

**Claude 可以做什么**:
- 分析媒体文件并建议组织方式
- 批量重命名文件
- 检测重复/相似媒体
- 根据内容自动分类

#### 2. Timeline State (`claude:timeline`)

**方案 A: 导出为 Markdown**

```markdown
# Project Timeline: My Video Project

## Track 1: Main Video
| Start | End | Type | Source | Effects |
|-------|-----|------|--------|---------|
| 0:00 | 0:05 | video | intro.mp4 | fade-in |
| 0:05 | 0:15 | video | main.mp4 | none |
| 0:15 | 0:20 | video | outro.mp4 | fade-out |

## Track 2: Background Music
| Start | End | Type | Source | Volume |
|-------|-----|------|--------|--------|
| 0:00 | 0:20 | audio | bgm.mp3 | 0.5 |

## Track 3: Text Overlays
| Start | End | Content | Style |
|-------|-----|---------|-------|
| 0:02 | 0:05 | "Welcome!" | title-large |
```

**方案 B: JSON Schema**

```typescript
// electron/claude-timeline-handler.ts

interface TimelineAPI {
  // 导出 timeline 为可读格式 (JSON 或 Markdown)
  "claude:timeline:export": (projectId: string, format: "json" | "md") => string;
  
  // 从可读格式导入/更新 timeline
  "claude:timeline:import": (projectId: string, data: string, format: "json" | "md") => void;
  
  // 获取特定时间点的状态
  "claude:timeline:snapshot": (projectId: string, timeMs: number) => TimelineSnapshot;
  
  // 添加元素
  "claude:timeline:addElement": (projectId: string, element: TimelineElement) => string;
  
  // 移动/调整元素
  "claude:timeline:updateElement": (projectId: string, elementId: string, changes: Partial<TimelineElement>) => void;
  
  // 删除元素
  "claude:timeline:removeElement": (projectId: string, elementId: string) => void;
}

interface TimelineElement {
  id?: string;
  trackIndex: number;
  startTime: number;  // ms
  endTime: number;    // ms
  type: "video" | "audio" | "image" | "text" | "effect";
  sourceId?: string;  // 媒体文件 ID
  content?: string;   // 文本内容
  style?: Record<string, any>;
  effects?: Effect[];
}
```

**Claude 可以做什么**:
- 分析 timeline 并建议优化（过长的静音、跳跃剪辑等）
- 自动添加转场效果
- 根据音乐节拍调整剪辑点
- 批量调整音量/时长
- 生成字幕 timeline

#### 3. Project Settings (`claude:project`)

```typescript
interface ProjectAPI {
  // 获取项目设置
  "claude:project:getSettings": (projectId: string) => ProjectSettings;
  
  // 更新项目设置
  "claude:project:updateSettings": (projectId: string, settings: Partial<ProjectSettings>) => void;
  
  // 获取项目统计
  "claude:project:getStats": (projectId: string) => ProjectStats;
}

interface ProjectSettings {
  name: string;
  resolution: { width: number; height: number };
  fps: number;
  aspectRatio: string;
  exportFormat: string;
  exportQuality: string;
}

interface ProjectStats {
  totalDuration: number;
  mediaCount: { video: number; audio: number; image: number };
  trackCount: number;
  lastModified: number;
}
```

#### 4. Export Control (`claude:export`)

```typescript
interface ExportAPI {
  // 获取导出预设
  "claude:export:getPresets": () => ExportPreset[];
  
  // 建议最佳导出设置
  "claude:export:recommend": (projectId: string, target: "youtube" | "tiktok" | "instagram" | "custom") => ExportSettings;
  
  // 开始导出
  "claude:export:start": (projectId: string, settings: ExportSettings) => ExportJob;
  
  // 获取导出进度
  "claude:export:progress": (jobId: string) => ExportProgress;
}
```

#### 5. AI Generation (`claude:ai`)

```typescript
interface AIGenerationAPI {
  // 列出可用的 AI 模型
  "claude:ai:listModels": () => AIModel[];
  
  // 生成图片/视频
  "claude:ai:generate": (request: AIGenerationRequest) => AIGenerationResult;
  
  // 获取生成历史
  "claude:ai:history": (projectId: string) => AIGenerationHistory[];
}
```

### 完整的 Claude API 层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Claude Code                              │
│         (通过 PTY 或 直接 API 调用)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Claude API Layer                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Media   │ │ Timeline │ │ Project  │ │  Export  │           │
│  │  API     │ │   API    │ │   API    │ │   API    │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │  Skills  │ │    AI    │ │  Config  │                        │
│  │   API    │ │   API    │ │   API    │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Qcut Core (Binary)                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Zustand  │ │  FFmpeg  │ │ Electron │ │  React   │           │
│  │ Stores   │ │   WASM   │ │   IPC    │ │   UI     │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 实现示例: Timeline Markdown Export/Import

```typescript
// electron/claude-timeline-handler.ts

import { ipcMain } from "electron";

export function setupClaudeTimelineIPC(): void {
  
  // 导出 Timeline 为 Markdown
  ipcMain.handle("claude:timeline:export", async (event, projectId: string, format: "md" | "json") => {
    const timeline = await loadTimelineFromStore(projectId);
    
    if (format === "md") {
      return timelineToMarkdown(timeline);
    }
    return JSON.stringify(timeline, null, 2);
  });
  
  // 从 Markdown 导入 Timeline
  ipcMain.handle("claude:timeline:import", async (event, projectId: string, data: string, format: "md" | "json") => {
    let timeline;
    
    if (format === "md") {
      timeline = markdownToTimeline(data);
    } else {
      timeline = JSON.parse(data);
    }
    
    // 验证并保存
    validateTimeline(timeline);
    await saveTimelineToStore(projectId, timeline);
    
    // 通知 UI 更新
    event.sender.send("timeline:updated", { projectId });
  });
}

function timelineToMarkdown(timeline: Timeline): string {
  let md = `# Timeline: ${timeline.name}\n\n`;
  md += `- Duration: ${formatTime(timeline.duration)}\n`;
  md += `- Resolution: ${timeline.width}x${timeline.height}\n`;
  md += `- FPS: ${timeline.fps}\n\n`;
  
  for (const track of timeline.tracks) {
    md += `## Track ${track.index + 1}: ${track.name || track.type}\n\n`;
    md += `| Start | End | Type | Source | Notes |\n`;
    md += `|-------|-----|------|--------|-------|\n`;
    
    for (const element of track.elements) {
      md += `| ${formatTime(element.start)} | ${formatTime(element.end)} | ${element.type} | ${element.sourceName || "-"} | ${element.notes || "-"} |\n`;
    }
    md += "\n";
  }
  
  return md;
}
```

### 使用场景

**场景 1: Claude 自动优化 Timeline**

```
用户: "帮我检查一下这个视频的 timeline，看看有没有问题"

Claude:
1. 调用 claude:timeline:export 获取 Markdown
2. 分析内容，发现:
   - Track 2 有 3 秒的空白
   - 音频在 0:15 突然结束
   - 转场效果不一致
3. 生成修复后的 Markdown
4. 调用 claude:timeline:import 应用修改
5. 返回修改说明给用户
```

**场景 2: Claude 整理媒体库**

```
用户: "帮我整理一下这个项目的媒体文件"

Claude:
1. 调用 claude:media:list 获取所有媒体
2. 分析文件名、元数据、使用情况
3. 建议分类方案
4. 调用 claude:media:rename 批量重命名
5. 返回整理报告
```

**场景 3: Claude 生成导出建议**

```
用户: "这个视频要发 TikTok，应该怎么导出？"

Claude:
1. 调用 claude:project:getStats 获取项目信息
2. 调用 claude:export:recommend("tiktok")
3. 分析当前项目是否符合 TikTok 要求
4. 如果不符合，建议调整（裁剪、调整时长等）
5. 返回最佳导出设置
```

---

## 📋 API 端口清单 (待实现)

| API | Handler 文件 | 优先级 | 状态 |
|-----|-------------|--------|------|
| `claude:media:*` | `claude-media-handler.ts` | P0 | ⬜ 待实现 |
| `claude:timeline:*` | `claude-timeline-handler.ts` | P0 | ⬜ 待实现 |
| `claude:project:*` | `claude-project-handler.ts` | P1 | ⬜ 待实现 |
| `claude:export:*` | `claude-export-handler.ts` | P1 | ⬜ 待实现 |
| `claude:skills:*` | 已有 `skills-handler.ts` | ✅ | ✅ 已有 |
| `claude:ai:*` | `claude-ai-handler.ts` | P2 | ⬜ 待实现 |

---

## 参考资源

- [Anthropic Claude API](https://docs.anthropic.com/)
- [Claude Code CLI](https://github.com/anthropics/claude-code)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) - 类似思路
- `electron/skills-handler.ts` - 现有 Skills 系统
- `electron/pty-handler.ts` - 现有 PTY 集成
- `electron/gemini-chat-handler.ts` - AI 集成参考

---

*创建日期: 2026-01-31*
*更新日期: 2026-01-31*
*状态: 架构分析完成，API 层设计中*
