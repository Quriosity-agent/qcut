# Gemini Terminal UI Implementation Plan

## Overview

Implement a terminal-like UI component within QCut's media panel that enables users to interact with Google's Gemini AI via a conversational interface. The terminal will have direct access to the media panel, allowing users to drag files into the chat and receive AI-assisted video editing suggestions.

**Priority Hierarchy**: Long-term maintainability > scalability > performance > short-term gains

## Feature Requirements

1. **Conversational Interface**: Terminal-style UI for chatting with Gemini AI
2. **Media Drag-and-Drop**: Users can drag files from the media panel into the terminal
3. **Media Context Access**: Gemini can read/analyze media items in the panel
4. **Streaming Responses**: Real-time streaming of AI responses
5. **Action Suggestions**: AI can suggest timeline operations (add clip, trim, etc.)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │   Media Panel   │  │      Gemini Terminal View        │  │
│  │   (Tab: gemini) │  │  - Message List                  │  │
│  │                 │──│  - Input Area (with drop zone)   │  │
│  │   Zustand Store │  │  - File Attachments Preview      │  │
│  │  (media-store)  │  │  - Streaming Response Display    │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
│           │                        │                         │
│           ▼                        ▼                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              gemini-terminal-store.ts                   ││
│  │  - messages[], attachments[], isStreaming, history      ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │ IPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Main Process                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              gemini-chat-handler.ts                     ││
│  │  - Chat with context (text + file references)           ││
│  │  - Streaming response via IPC events                    ││
│  │  - Media file analysis (read file, encode, send)        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Subtasks

### Subtask 1: Electron IPC Handler for Gemini Chat

**Description**: Create a new IPC handler that manages Gemini API communication with support for multimodal inputs (text + images/videos) and streaming responses.

**Relevant Files**:
- `electron/gemini-chat-handler.ts` (NEW)
- `electron/main.ts` (MODIFY - register handler)
- `electron/gemini-transcribe-handler.ts` (REFERENCE - existing Gemini pattern)
- `apps/web/src/types/electron.d.ts` (MODIFY - add types)

**Implementation Details**:
```typescript
// electron/gemini-chat-handler.ts
interface GeminiChatRequest {
  messages: ChatMessage[];
  attachments?: FileAttachment[];
  model?: string; // default: gemini-2.0-flash
  streamCallback?: string; // IPC channel for streaming
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileAttachment[];
}

interface FileAttachment {
  path: string;        // Absolute file path
  mimeType: string;    // e.g., "image/jpeg", "video/mp4"
  name: string;        // Display name
}
```

**Key Features**:
- Use `@google/generative-ai` SDK (already a dependency)
- Implement streaming via `model.generateContentStream()`
- Send chunks via `webContents.send()` to renderer
- Support multimodal input (text + images + video frames)
- Reuse API key retrieval from `gemini-transcribe-handler.ts`

**Test Cases**:
- `electron/__tests__/gemini-chat-handler.test.ts` (NEW)
  - Test API key retrieval
  - Test message formatting
  - Test streaming callback invocation
  - Test file attachment encoding

---

### Subtask 2: Zustand Store for Terminal State

**Description**: Create a dedicated Zustand store to manage chat history, current attachments, streaming state, and terminal UI state.

**Relevant Files**:
- `apps/web/src/stores/gemini-terminal-store.ts` (NEW)
- `apps/web/src/stores/media-store.ts` (REFERENCE - MediaItem type)

**Implementation Details**:
```typescript
// apps/web/src/stores/gemini-terminal-store.ts
interface GeminiTerminalStore {
  // Chat state
  messages: ChatMessage[];
  isStreaming: boolean;
  currentStreamingContent: string;

  // Attachments (files dragged into terminal)
  pendingAttachments: AttachedFile[];

  // UI state
  isExpanded: boolean;
  inputValue: string;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  addAttachment: (file: AttachedFile) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  clearHistory: () => void;

  // Streaming handlers
  handleStreamChunk: (chunk: string) => void;
  handleStreamComplete: () => void;
  handleStreamError: (error: string) => void;
}

interface AttachedFile {
  id: string;
  mediaId?: string;     // Reference to MediaItem if from media panel
  path: string;         // File path (for Electron)
  name: string;
  type: 'image' | 'video' | 'audio';
  thumbnailUrl?: string;
}
```

**Test Cases**:
- `apps/web/src/stores/__tests__/gemini-terminal-store.test.ts` (NEW)
  - Test message send flow
  - Test attachment add/remove
  - Test streaming state updates
  - Test history clear

---

### Subtask 3: Media Panel Tab Registration

**Description**: Register the Gemini Terminal as a new tab in the media panel system.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/store.ts` (MODIFY)
- `apps/web/src/components/editor/media-panel/index.tsx` (MODIFY)

**Implementation Details**:

1. Add to `store.ts`:
```typescript
export type Tab =
  | "media"
  | "audio"
  // ... existing tabs ...
  | "gemini";  // NEW

export const tabs: { [key in Tab]: { icon: LucideIcon; label: string } } = {
  // ... existing tabs ...
  gemini: {
    icon: TerminalIcon,  // from lucide-react
    label: "Gemini",
  },
};
```

2. Add to `index.tsx`:
```typescript
import { GeminiTerminalView } from "./views/gemini-terminal";

const viewMap: Record<Tab, React.ReactNode> = {
  // ... existing views ...
  gemini: <GeminiTerminalView />,
};
```

**Test Cases**:
- Verify tab appears in tabbar
- Verify tab switching works correctly

---

### Subtask 4: Gemini Terminal View Component

**Description**: Create the main terminal UI component with message display, input area, and drag-drop zone for media files.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/gemini-terminal.tsx` (NEW)
- `apps/web/src/hooks/use-drag-drop.ts` (REFERENCE)
- `apps/web/src/components/ui/scroll-area.tsx` (REUSE)
- `apps/web/src/components/ui/button.tsx` (REUSE)
- `apps/web/src/components/ui/textarea.tsx` (REUSE)

**Component Structure**:
```tsx
export function GeminiTerminalView() {
  return (
    <div className="flex flex-col h-full">
      {/* Header with clear button */}
      <TerminalHeader />

      {/* Scrollable message list */}
      <ScrollArea className="flex-1">
        <MessageList messages={messages} />
      </ScrollArea>

      {/* Attachment preview bar */}
      {attachments.length > 0 && (
        <AttachmentBar attachments={attachments} />
      )}

      {/* Input area with drop zone */}
      <TerminalInput
        onSubmit={handleSubmit}
        onDrop={handleFileDrop}
        disabled={isStreaming}
      />
    </div>
  );
}
```

**Accessibility Requirements**:
- All buttons must have `type="button"`
- Input must have proper `aria-label`
- Messages must be in a `role="log"` container
- Drop zone must have `aria-describedby` for screen readers
- Use semantic `<button>` elements, not `<div onClick>`

**Test Cases**:
- `apps/web/src/components/editor/media-panel/views/__tests__/gemini-terminal.test.tsx` (NEW)
  - Test message rendering
  - Test input submission
  - Test file drop handling
  - Test streaming state UI
  - Test accessibility attributes

---

### Subtask 5: Message Components

**Description**: Create reusable components for displaying user and assistant messages, including code blocks, markdown rendering, and file attachments.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/gemini-terminal/message-item.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/gemini-terminal/code-block.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/gemini-terminal/attachment-preview.tsx` (NEW)

**Implementation Details**:
```tsx
// message-item.tsx
interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageItem({ message, isStreaming }: MessageItemProps) {
  return (
    <div className={cn(
      "p-3 rounded-lg",
      message.role === 'user'
        ? "bg-primary/10 ml-8"
        : "bg-muted mr-8"
    )}>
      {/* Role indicator */}
      <div className="flex items-center gap-2 mb-1">
        {message.role === 'user' ? <UserIcon /> : <BotIcon />}
        <span className="text-xs text-muted-foreground">
          {message.role === 'user' ? 'You' : 'Gemini'}
        </span>
      </div>

      {/* Attachments if any */}
      {message.attachments?.map(att => (
        <AttachmentPreview key={att.id} attachment={att} />
      ))}

      {/* Message content with markdown */}
      <div className="prose prose-sm dark:prose-invert">
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>

      {/* Streaming indicator */}
      {isStreaming && <StreamingCursor />}
    </div>
  );
}
```

**Test Cases**:
- Test user message styling
- Test assistant message styling
- Test markdown rendering
- Test code block syntax highlighting
- Test attachment preview display

---

### Subtask 6: Drag-and-Drop Integration with Media Panel

**Description**: Enable dragging media items from the media panel into the terminal input area, converting MediaItem references to file attachments.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/gemini-terminal.tsx` (MODIFY)
- `apps/web/src/components/ui/draggable-item.tsx` (REFERENCE)
- `apps/web/src/stores/media-store.ts` (REFERENCE)
- `apps/web/src/hooks/use-drag-drop.ts` (EXTEND or create new hook)

**Implementation Details**:

1. Create a custom hook for media panel drag handling:
```typescript
// apps/web/src/hooks/use-media-drop.ts (NEW)
export function useMediaDrop(options: {
  onMediaDrop: (items: MediaItem[]) => void;
  onFileDrop?: (files: FileList) => void;
}) {
  // Handle both internal media item drags AND external file drops
  // Check for 'application/x-media-item' data type
}
```

2. In the terminal input component:
```tsx
function TerminalInput({ onMediaDrop, onFileDrop }) {
  const { isDragOver, dragProps } = useMediaDrop({
    onMediaDrop: (items) => {
      // Convert MediaItem to AttachedFile
      items.forEach(item => {
        addAttachment({
          id: generateUUID(),
          mediaId: item.id,
          path: item.file ? getFilePath(item.file) : item.url,
          name: item.name,
          type: item.type,
          thumbnailUrl: item.thumbnailUrl,
        });
      });
    },
    onFileDrop: (files) => {
      // Handle external file drops
    },
  });

  return (
    <div {...dragProps} className={cn(isDragOver && "ring-2 ring-primary")}>
      {/* Input content */}
    </div>
  );
}
```

**Test Cases**:
- Test media item drag detection
- Test conversion from MediaItem to AttachedFile
- Test external file drop handling
- Test drop zone visual feedback

---

### Subtask 7: Streaming Response Handler

**Description**: Implement real-time streaming of Gemini responses from the main process to the renderer, updating the UI progressively.

**Relevant Files**:
- `electron/gemini-chat-handler.ts` (MODIFY)
- `electron/preload.ts` (MODIFY - add stream listener)
- `apps/web/src/stores/gemini-terminal-store.ts` (MODIFY)
- `apps/web/src/types/electron.d.ts` (MODIFY)

**Implementation Details**:

1. Main process streaming:
```typescript
// electron/gemini-chat-handler.ts
ipcMain.handle('gemini:chat', async (event, request: GeminiChatRequest) => {
  const model = genAI.getGenerativeModel({ model: request.model || 'gemini-2.0-flash' });

  const result = await model.generateContentStream([
    ...formatMessages(request.messages),
    ...formatAttachments(request.attachments),
  ]);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    event.sender.send('gemini:stream-chunk', { text });
  }

  event.sender.send('gemini:stream-complete');
});
```

2. Preload bridge:
```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  gemini: {
    chat: (request) => ipcRenderer.invoke('gemini:chat', request),
    onStreamChunk: (callback) => {
      ipcRenderer.on('gemini:stream-chunk', (_, data) => callback(data));
    },
    onStreamComplete: (callback) => {
      ipcRenderer.on('gemini:stream-complete', () => callback());
    },
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('gemini:stream-chunk');
      ipcRenderer.removeAllListeners('gemini:stream-complete');
    },
  },
});
```

3. Renderer store integration:
```typescript
// apps/web/src/stores/gemini-terminal-store.ts
sendMessage: async (content: string) => {
  set({ isStreaming: true, currentStreamingContent: '' });

  // Set up listeners
  window.electronAPI?.gemini?.onStreamChunk(({ text }) => {
    set(state => ({
      currentStreamingContent: state.currentStreamingContent + text
    }));
  });

  window.electronAPI?.gemini?.onStreamComplete(() => {
    const finalContent = get().currentStreamingContent;
    set(state => ({
      messages: [...state.messages, { role: 'assistant', content: finalContent }],
      isStreaming: false,
      currentStreamingContent: '',
    }));
    window.electronAPI?.gemini?.removeStreamListeners();
  });

  await window.electronAPI?.gemini?.chat({ messages, attachments });
}
```

**Test Cases**:
- Test chunk accumulation
- Test stream completion
- Test error handling during stream
- Test listener cleanup

---

### Subtask 8: File Attachment Encoding for Gemini API

**Description**: Implement utilities to read media files from disk and encode them for the Gemini API (base64 for images, frame extraction for videos).

**Relevant Files**:
- `electron/gemini-chat-handler.ts` (MODIFY)
- `electron/ffmpeg-handler.ts` (REFERENCE - for video frame extraction)

**Implementation Details**:
```typescript
// electron/gemini-chat-handler.ts

async function encodeAttachment(attachment: FileAttachment): Promise<GeminiPart> {
  const buffer = await fs.readFile(attachment.path);

  if (attachment.mimeType.startsWith('image/')) {
    return {
      inlineData: {
        mimeType: attachment.mimeType,
        data: buffer.toString('base64'),
      },
    };
  }

  if (attachment.mimeType.startsWith('video/')) {
    // Extract key frames using FFmpeg
    const frames = await extractKeyFrames(attachment.path, 5); // 5 frames
    return {
      inlineData: {
        mimeType: 'image/jpeg',
        data: frames[0], // Send first frame, or combine
      },
    };
  }

  // Audio: use existing transcription or send as audio
  if (attachment.mimeType.startsWith('audio/')) {
    return {
      inlineData: {
        mimeType: attachment.mimeType,
        data: buffer.toString('base64'),
      },
    };
  }
}
```

**Test Cases**:
- Test image encoding
- Test video frame extraction
- Test audio encoding
- Test unsupported file type handling

---

### Subtask 9: Context Menu Actions for Media Items

**Description**: Add a context menu option to media items that sends them directly to Gemini for analysis (e.g., "Analyze with Gemini", "Describe this video").

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/media.tsx` (MODIFY)
- `apps/web/src/components/ui/context-menu.tsx` (REUSE)
- `apps/web/src/stores/gemini-terminal-store.ts` (USE)

**Implementation Details**:
```tsx
// In media item context menu
<ContextMenuItem
  onClick={() => {
    // Switch to Gemini tab
    setActiveTab('gemini');

    // Add media as attachment
    geminiStore.addAttachment({
      id: generateUUID(),
      mediaId: item.id,
      path: getFilePath(item),
      name: item.name,
      type: item.type,
      thumbnailUrl: item.thumbnailUrl,
    });

    // Optionally pre-fill prompt
    geminiStore.setInputValue('Describe this media file:');
  }}
>
  <Sparkles className="mr-2 h-4 w-4" />
  Analyze with Gemini
</ContextMenuItem>
```

**Test Cases**:
- Test context menu appears
- Test tab switching
- Test attachment addition
- Test prompt pre-fill

---

### Subtask 10: Electron API Type Definitions

**Description**: Update TypeScript definitions for the new Gemini chat API exposed via Electron.

**Relevant Files**:
- `apps/web/src/types/electron.d.ts` (MODIFY)

**Implementation Details**:
```typescript
// apps/web/src/types/electron.d.ts

interface GeminiChatAPI {
  chat: (request: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    attachments?: Array<{
      path: string;
      mimeType: string;
      name: string;
    }>;
    model?: string;
  }) => Promise<void>;

  onStreamChunk: (callback: (data: { text: string }) => void) => void;
  onStreamComplete: (callback: () => void) => void;
  onStreamError: (callback: (error: { message: string }) => void) => void;
  removeStreamListeners: () => void;
}

export interface ElectronAPI {
  // ... existing properties ...

  gemini: GeminiChatAPI;
}
```

---

## Implementation Order

1. **Subtask 1**: Electron IPC Handler (foundation)
2. **Subtask 10**: Type Definitions (enables type-safe development)
3. **Subtask 2**: Zustand Store (state management)
4. **Subtask 3**: Tab Registration (UI entry point)
5. **Subtask 4**: Terminal View Component (main UI)
6. **Subtask 5**: Message Components (UI building blocks)
7. **Subtask 6**: Drag-and-Drop Integration (core feature)
8. **Subtask 7**: Streaming Response Handler (UX improvement)
9. **Subtask 8**: File Attachment Encoding (multimodal support)
10. **Subtask 9**: Context Menu Actions (convenience feature)

---

## Testing Strategy

### Unit Tests
- All new stores: `gemini-terminal-store.test.ts`
- IPC handlers: `gemini-chat-handler.test.ts`
- Utility functions: `gemini-utils.test.ts`

### Component Tests
- Terminal view: `gemini-terminal.test.tsx`
- Message components: `message-item.test.tsx`
- Attachment preview: `attachment-preview.test.tsx`

### Integration Tests
- Full chat flow with mocked Electron API
- Drag-and-drop from media panel to terminal
- Streaming response display

### Manual Testing Checklist
- [ ] Send text message and receive response
- [ ] Drag image from media panel, send with prompt
- [ ] Drag video, verify frame extraction works
- [ ] Test streaming response display
- [ ] Test error handling (no API key, network error)
- [ ] Test keyboard navigation (Tab, Enter, Escape)
- [ ] Test screen reader compatibility

---

## Dependencies

### New Dependencies
None required - uses existing:
- `@google/generative-ai` (already installed)
- `react-markdown` (if not installed: `bun add react-markdown`)
- `lucide-react` (already installed)

### Existing Dependencies Used
- Zustand for state management
- Radix UI components (ScrollArea, Button, etc.)
- Tailwind CSS for styling

---

## Security Considerations

1. **API Key Storage**: Reuse existing secure storage from `api-key-handler.ts`
2. **File Access**: Only allow access to files already in the media panel
3. **Prompt Injection**: Sanitize user input before sending to Gemini
4. **Response Sanitization**: Escape any HTML in Gemini responses before rendering

---

## Performance Considerations

1. **Lazy Loading**: Load Gemini terminal view only when tab is active
2. **Message Virtualization**: Use virtual scrolling for long chat histories
3. **Attachment Thumbnails**: Reuse existing thumbnails from MediaItem
4. **Streaming Chunks**: Batch UI updates to avoid excessive re-renders

---

## Future Enhancements

1. **Action Execution**: Allow Gemini to suggest and execute timeline operations
2. **Voice Input**: Add speech-to-text for voice commands
3. **Conversation Persistence**: Save chat history per project
4. **Custom Prompts**: User-defined prompt templates for common tasks
5. **Multi-model Support**: Allow switching between Gemini models

---

## Related Documentation

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [QCut CLAUDE.md](../../../CLAUDE.md) - Project conventions
- [Media Panel Architecture](../../architecture/media-panel.md) - Existing patterns
