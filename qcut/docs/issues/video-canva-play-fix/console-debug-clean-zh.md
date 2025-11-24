# Canvas 视频播放调试 - 简洁控制台分析

## 核心问题
**Canvas 只显示静态图像而不播放视频，因为 blob URLs 在视频能够播放之前就被过早地撤销了。**

## 最新证据 (consolev11)

### Blob 生命周期模式
1. **创建阶段**: Blob 成功创建并正确跟踪
   - `blob:app://./7de6d66a-9f2c-44b6-92e9-3cfce7085413` 为视频播放创建
   - 来源: `media-source:getVideoSource`
   - 大小: 1804357 字节 (1.8MB 视频文件)

2. **过早撤销**: Blob 仅在 2.19 秒后就被撤销
   - 撤销者: `at zn → at app://./assets/editor._project_id.lazy-DVbcJekg.js:300:16659`
   - 结果: `Failed to load resource: net::ERR_FILE_NOT_FOUND`
   - 视频元素无法在没有有效源的情况下播放

3. **清理迁移问题**: Blob 清理在启动时运行
   - 从存储中清除 blob URLs (第11行: "Cleared blob URL for media item: kling.mp4")
   - 创建新的 blob 但它们仍然被过快撤销

## 关键控制台模式

### 实际发生的情况:
```
[BlobManager] 🟢 已创建: blob:app://./7de6d66a...
  📍 来源: media-source:getVideoSource
  ⏱️ 存活时间: 2191毫秒

[PLAYBACK] 点击播放
// 时间轴更新发生 (步骤 6: 时间轴播放头已更新)

[BlobManager] 🔴 已撤销: blob:app://./7de6d66a...
[BlobUrlDebug] 撤销未跟踪: blob:app://./7de6d66a...
blob:app://./7de6d66a... 加载资源失败: net::ERR_FILE_NOT_FOUND
```

### 应该发生的情况:
```
[BlobManager] 🟢 已创建: 视频的 blob
[PLAYBACK] 点击播放
视频成功播放
[BlobManager] 🔴 已撤销: blob (仅在播放停止后)
```

## 关键发现
- **Blob 跟踪正常**: BlobManager 和 BlobUrlDebug 都在正确监控
- **存活时间太短**: Blob 在 130毫秒-2.2秒 后被撤销（对于视频缓冲来说太短了）
- **未跟踪的撤销**: 一些撤销绕过了 blob 管理器（"撤销未跟踪"）
- **播放尝试正常**: 时间轴更新显示播放正在运行
- **但视频无法加载**: Blob URL 在视频元素能够缓冲之前就消失了

## 需要的修复
1. **防止过早撤销**: 在活动播放期间保持 blob 存活
2. **跟踪活动视频源**: 在视频播放时将 blob 标记为"使用中"
3. **修复清理时机**: 只在视频元素被销毁或播放停止时撤销
4. **处理未跟踪的撤销**: 通过 blob 管理器路由所有撤销

## 成功标准
- Blob URLs 在整个播放会话期间保持有效
- 活动播放期间没有 `ERR_FILE_NOT_FOUND` 错误
- 视频元素成功缓冲并播放
- Canvas 渲染视频帧（不是静态图像）

## 调试状态
- ✅ 已修复: 60fps 监听器重建问题
- ✅ 已修复: 控制台日志已移除，输出更清晰
- ✅ 正常工作: Blob 创建和跟踪
- ❌ 关键问题: Blob 在仍需要时被撤销
- ❌ 被阻塞: 视频无法在没有有效 blob 的情况下缓冲
- ❌ 被阻塞: Canvas 无法在没有播放视频的情况下渲染

## 问题根源分析

### 为什么会发生这个问题？
1. **生命周期管理错误**: 代码在视频仍在使用时就清理了 blob URLs
2. **React 组件重新渲染**: 组件重新渲染可能触发了不必要的清理
3. **缺少引用计数**: 系统没有跟踪哪些 blob 正在被活跃使用

### 技术细节
- Blob URL 生命周期: 创建 → 使用 → 撤销
- 当前问题: 创建 → 撤销 → 尝试使用（失败）
- 正确流程: 创建 → 使用 → 使用完成 → 撤销

## 下一步行动
1. 检查 `editor._project_id.lazy-DVbcJekg.js:300:16659` 处的撤销逻辑
2. 实现 blob URL 的引用计数系统
3. 确保播放期间 blob URLs 保持活跃
4. 添加播放状态检查以防止过早清理

---

## 替代方案：直接使用 File 对象（用户建议）

### 问题
"如果视频已上传到媒体库，它应该有本地路径，我们能用吗？"

### 答案
✅ **可以 - 我们已经可以访问 File 对象，但没有传统的本地文件系统路径。**

### 当前架构
- **MediaItem** 包含 `file: File` 属性（存储在 OPFS 中的实际文件数据）
- **存储**: 文件通过 `storage-service.ts` 存储在源私有文件系统 (OPFS) 中
- **访问**: File 对象可用，但无法直接访问文件系统路径（浏览器安全限制）

### 为什么传统本地路径不可用
1. **Web 安全**: 浏览器不会暴露用户上传文件的真实文件系统路径
2. **OPFS**: 虚拟文件系统，不是真正的操作系统文件系统
3. **File API**: 浏览器环境中 `File` 对象不提供 `file://` URL

### 建议方案：延迟创建 Blob URL
不是提前创建 blob URL 并管理复杂生命周期，而是：

**策略：按需创建 blob URL 并在播放期间保持它们存活**

```typescript
// 当前方案（有问题）：
// 1. 在 getVideoSource() 中提前创建 blob URL
// 2. 将 blob URL 传递给 video-player
// 3. 视频还在缓冲时 blob 就被撤销了
// 4. ERR_FILE_NOT_FOUND

// 建议方案（稳定）：
// 1. 将 File 对象传递给 video-player（不是 blob URL）
// 2. 设置 video.src 时才创建 blob URL
// 3. 保持 blob URL 存活直到 canplay/playing 事件
// 4. 只在播放停止后撤销
```

### 实现要点
1. **media-source.ts**: 返回 File 对象而不是 blob URL
2. **video-player.tsx**: 需要时从 File 创建 blob URL，成功播放后撤销
3. **preview-panel.tsx**: 移除激进的清理效果（628-633 行）
4. **Blob 生命周期**: 绑定到视频元素状态，而非组件重新渲染

### 优势
- 消除过早撤销（ERR_FILE_NOT_FOUND 的根本原因）
- Blob URL 仅在活动播放期间存在
- File 对象稳定且不会过期
- 更简单的心智模型：File → blob URL → 播放 → 撤销

### File 访问模式
```typescript
// MediaItem 结构
interface MediaItem {
  id: string;
  file: File;           // ✅ 我们已经有这个了！
  url?: string;         // Blob URL（临时的）
  // ...
}

// 建议的流程
function VideoPlayer({ file }: { file: File }) {
  const blobUrlRef = useRef<string | null>(null);

  // 只在需要时创建 blob URL
  useEffect(() => {
    if (!file) return;

    blobUrlRef.current = URL.createObjectURL(file);
    videoRef.current.src = blobUrlRef.current;

    // 只在成功播放后或组件卸载时撤销
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, [file]);
}
```

### 与当前方案的对比

**当前方案的问题:**
- ❌ Blob URL 在组件渲染时就创建了
- ❌ 多个地方尝试撤销 blob URLs（preview-panel、media-store、video-player）
- ❌ 撤销时机取决于组件重新渲染，而非播放状态
- ❌ 视频元素无法控制其源的生命周期

**新方案的优势:**
- ✅ File 对象作为稳定的数据源传递
- ✅ Blob URL 由使用它的组件（video-player）创建和管理
- ✅ 生命周期完全由播放状态控制
- ✅ 不再有"未跟踪的撤销"问题
- ✅ 更简单、更可预测的代码流程

### 实现步骤
1. **步骤 1**: 修改 `media-source.ts` 返回 File 对象
2. **步骤 2**: 更新 `preview-panel.tsx` 传递 File 而非 blob URL
3. **步骤 3**: 重构 `video-player.tsx` 从 File 创建 blob URL
4. **步骤 4**: 移除所有外部 blob URL 清理逻辑
5. **步骤 5**: 测试播放功能确保视频能正常缓冲和播放