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
- `electron/main.ts` (MODIFY - register handler at line ~71 and ~367)
- `electron/gemini-transcribe-handler.ts` (REFERENCE - existing Gemini pattern)

**Implementation Details**:
```typescript
// electron/gemini-chat-handler.ts
import { ipcMain, app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import { safeStorage } from "electron";

// Dynamic import for @google/generative-ai (same pattern as gemini-transcribe-handler.ts)
let GoogleGenerativeAI: any;
try {
  GoogleGenerativeAI = require("@google/generative-ai").GoogleGenerativeAI;
} catch {
  const modulePath = path.join(process.resourcesPath, "node_modules/@google/generative-ai/dist/index.js");
  GoogleGenerativeAI = require(modulePath).GoogleGenerativeAI;
}

interface GeminiChatRequest {
  messages: ChatMessage[];
  attachments?: FileAttachment[];
  model?: string; // default: gemini-2.0-flash
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface FileAttachment {
  path: string;        // Absolute file path
  mimeType: string;    // e.g., "image/jpeg", "video/mp4"
  name: string;        // Display name
}

export function setupGeminiChatIPC(): void {
  // Reuse API key retrieval pattern from gemini-transcribe-handler.ts
  // Implementation here...
}
```

**Registration in main.ts** (around line 71):
```typescript
const { setupGeminiChatIPC } = require("./gemini-chat-handler.js");
```

**Registration in main.ts** (around line 367):
```typescript
setupGeminiChatIPC(); // Add Gemini chat support
```

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
- `apps/web/src/stores/media-store-types.ts` (REFERENCE - type definitions)

**Implementation Details**:
```typescript
// apps/web/src/stores/gemini-terminal-store.ts
import { create } from "zustand";
import { generateUUID } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: AttachedFile[];
  timestamp: number;
}

interface AttachedFile {
  id: string;
  mediaId?: string;     // Reference to MediaItem if from media panel
  path: string;         // File path (for Electron IPC)
  name: string;
  type: 'image' | 'video' | 'audio';
  thumbnailUrl?: string;
  mimeType: string;
}

interface GeminiTerminalStore {
  // Chat state
  messages: ChatMessage[];
  isStreaming: boolean;
  currentStreamingContent: string;
  error: string | null;

  // Attachments (files dragged into terminal)
  pendingAttachments: AttachedFile[];

  // UI state
  inputValue: string;
  setInputValue: (value: string) => void;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  addAttachment: (file: AttachedFile) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  clearHistory: () => void;

  // Streaming handlers (called by IPC listeners)
  handleStreamChunk: (chunk: string) => void;
  handleStreamComplete: () => void;
  handleStreamError: (error: string) => void;
}

export const useGeminiTerminalStore = create<GeminiTerminalStore>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentStreamingContent: '',
  error: null,
  pendingAttachments: [],
  inputValue: '',

  setInputValue: (value) => set({ inputValue: value }),

  // ... implementation
}));
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
- `apps/web/src/components/editor/media-panel/store.ts` (MODIFY - lines 23-41 for Tab type, lines 42-111 for tabs object)
- `apps/web/src/components/editor/media-panel/index.tsx` (MODIFY - lines 1-19 for imports, lines 34-68 for viewMap)

**Implementation Details**:

1. Add to `store.ts` (after line 40, before the semicolon):
```typescript
export type Tab =
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "video-edit"
  | "effects"
  | "transitions"
  | "captions"
  | "filters"
  | "adjustment"
  | "text2image"
  | "nano-edit"
  | "ai"
  | "sounds"
  | "draw"
  | "segmentation"
  | "remotion"
  | "gemini";  // NEW - add before semicolon
```

2. Add to `tabs` object in `store.ts` (after line 110, inside the object):
```typescript
  gemini: {
    icon: TerminalIcon,  // import { TerminalIcon } from "lucide-react"
    label: "Gemini",
  },
```

3. Add to `index.tsx` imports (around line 18):
```typescript
import { GeminiTerminalView } from "./views/gemini-terminal";
```

4. Add to `viewMap` in `index.tsx` (around line 67):
```typescript
  gemini: <GeminiTerminalView />,
```

**Test Cases**:
- Verify tab appears in tabbar
- Verify tab switching works correctly
- Verify icon displays correctly

---

### Subtask 4: Gemini Terminal View Component

**Description**: Create the main terminal UI component with message display, input area, and drag-drop zone for media files.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/gemini-terminal.tsx` (NEW)
- `apps/web/src/hooks/use-drag-drop.ts` (REFERENCE - line 8-16 for drag type detection)
- `apps/web/src/components/ui/scroll-area.tsx` (REUSE)
- `apps/web/src/components/ui/button.tsx` (REUSE)
- `apps/web/src/components/ui/textarea.tsx` (REUSE)

**Component Structure**:
```tsx
"use client";

import { useGeminiTerminalStore } from "@/stores/gemini-terminal-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Trash2, X, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { MessageItem } from "./gemini-terminal/message-item";
import { AttachmentPreview } from "./gemini-terminal/attachment-preview";

export function GeminiTerminalView() {
  const {
    messages,
    isStreaming,
    currentStreamingContent,
    pendingAttachments,
    inputValue,
    setInputValue,
    sendMessage,
    removeAttachment,
    clearAttachments,
    clearHistory,
  } = useGeminiTerminalStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, currentStreamingContent]);

  const handleSubmit = async () => {
    if (!inputValue.trim() && pendingAttachments.length === 0) return;
    await sendMessage(inputValue);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-sm font-medium">Gemini Chat</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearHistory}
          disabled={messages.length === 0}
          aria-label="Clear chat history"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Message List */}
      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div role="log" aria-live="polite" aria-label="Chat messages">
          {messages.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}
          {isStreaming && currentStreamingContent && (
            <MessageItem
              message={{
                id: 'streaming',
                role: 'assistant',
                content: currentStreamingContent,
                timestamp: Date.now(),
              }}
              isStreaming
            />
          )}
        </div>
      </ScrollArea>

      {/* Attachment Preview Bar */}
      {pendingAttachments.length > 0 && (
        <div className="flex gap-2 p-2 border-t overflow-x-auto">
          {pendingAttachments.map((att) => (
            <AttachmentPreview
              key={att.id}
              attachment={att}
              onRemove={() => removeAttachment(att.id)}
            />
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="p-2 border-t">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Gemini about your media..."
            className="min-h-[60px] resize-none"
            disabled={isStreaming}
            aria-label="Chat message input"
          />
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isStreaming || (!inputValue.trim() && pendingAttachments.length === 0)}
            aria-label="Send message"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Drag media from the panel or type a message. Press Enter to send.
        </p>
      </div>
    </div>
  );
}
```

**Accessibility Requirements** (from CLAUDE.md):
- All buttons must have `type="button"`
- Input must have proper `aria-label`
- Messages must be in a `role="log"` container with `aria-live="polite"`
- Use semantic `<button>` elements, not `<div onClick>`

**Test Cases**:
- `apps/web/src/components/editor/media-panel/views/__tests__/gemini-terminal.test.tsx` (NEW)
  - Test message rendering
  - Test input submission
  - Test streaming state UI
  - Test accessibility attributes

---

### Subtask 5: Message Components

**Description**: Create reusable components for displaying user and assistant messages, including markdown rendering and file attachments.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/gemini-terminal/message-item.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/gemini-terminal/attachment-preview.tsx` (NEW)

**Dependencies** (already installed in package.json):
- `react-markdown` v10.1.0
- `rehype-sanitize` v6.0.0

**Implementation Details**:
```tsx
// message-item.tsx
"use client";

import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { AttachmentPreview } from "./attachment-preview";

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    thumbnailUrl?: string;
  }>;
  timestamp: number;
}

interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageItem({ message, isStreaming }: MessageItemProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg mb-2",
        message.role === 'user'
          ? "bg-primary/10 ml-8"
          : "bg-muted mr-8"
      )}
    >
      {/* Role indicator */}
      <div className="flex items-center gap-2 mb-1">
        {message.role === 'user' ? (
          <User className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Bot className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="text-xs text-muted-foreground">
          {message.role === 'user' ? 'You' : 'Gemini'}
        </span>
      </div>

      {/* Attachments if any */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {message.attachments.map(att => (
            <AttachmentPreview key={att.id} attachment={att} compact />
          ))}
        </div>
      )}

      {/* Message content with markdown */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
          {message.content}
        </ReactMarkdown>
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-foreground animate-pulse ml-1" />
      )}
    </div>
  );
}
```

```tsx
// attachment-preview.tsx
"use client";

import { cn } from "@/lib/utils";
import { X, Image, Video, Music, File } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AttachmentPreviewProps {
  attachment: {
    id: string;
    name: string;
    type: string;
    thumbnailUrl?: string;
  };
  onRemove?: () => void;
  compact?: boolean;
}

export function AttachmentPreview({ attachment, onRemove, compact }: AttachmentPreviewProps) {
  const Icon = {
    image: Image,
    video: Video,
    audio: Music,
  }[attachment.type] || File;

  return (
    <div
      className={cn(
        "relative rounded border bg-muted/50 overflow-hidden",
        compact ? "w-12 h-12" : "w-16 h-16"
      )}
    >
      {attachment.thumbnailUrl ? (
        <img
          src={attachment.thumbnailUrl}
          alt={attachment.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      {onRemove && (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="absolute -top-1 -right-1 h-4 w-4 rounded-full"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
```

**Test Cases**:
- Test user message styling
- Test assistant message styling
- Test markdown rendering (headers, code blocks, lists)
- Test attachment preview display
- Test remove button functionality

---

### Subtask 6: Drag-and-Drop Integration with Media Panel

**Description**: Enable dragging media items from the media panel into the terminal input area, converting MediaItem references to file attachments.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/gemini-terminal.tsx` (MODIFY)
- `apps/web/src/components/ui/draggable-item.tsx` (REFERENCE - line 85-88 for drag data format)
- `apps/web/src/stores/media-store.ts` (REFERENCE)
- `apps/web/src/hooks/use-drag-drop.ts` (REFERENCE - line 8-16)

**Key Discovery**: The drag data format from `draggable-item.tsx`:
```typescript
// Line 85-88 in draggable-item.tsx
e.dataTransfer.setData(
  "application/x-media-item",
  JSON.stringify(dragData)  // { id, type, name }
);
```

**Implementation Details**:

1. Create a custom hook for media panel drag handling:
```typescript
// apps/web/src/hooks/use-media-drop.ts (NEW)
import { useState, useRef } from "react";
import { useMediaStore } from "@/stores/media-store";

interface UseMediaDropOptions {
  onMediaDrop: (mediaIds: string[]) => void;
  onFileDrop?: (files: FileList) => void;
}

export function useMediaDrop(options: UseMediaDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;

    // Check for internal media item drag
    if (e.dataTransfer.types.includes("application/x-media-item")) {
      setIsDragOver(true);
      return;
    }

    // Check for external file drag
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    // Handle internal media item drop
    const mediaData = e.dataTransfer.getData("application/x-media-item");
    if (mediaData) {
      try {
        const { id } = JSON.parse(mediaData);
        options.onMediaDrop([id]);
        return;
      } catch (err) {
        console.error("Failed to parse media drag data:", err);
      }
    }

    // Handle external file drop
    if (options.onFileDrop && e.dataTransfer.files.length > 0) {
      options.onFileDrop(e.dataTransfer.files);
    }
  };

  return {
    isDragOver,
    dragProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
```

2. Update terminal input to use the hook:
```tsx
// In gemini-terminal.tsx
import { useMediaDrop } from "@/hooks/use-media-drop";
import { useAsyncMediaStore } from "@/hooks/use-async-media-store";

// Inside component:
const { store: mediaStore } = useAsyncMediaStore();
const { addAttachment } = useGeminiTerminalStore();

const { isDragOver, dragProps } = useMediaDrop({
  onMediaDrop: (mediaIds) => {
    mediaIds.forEach(id => {
      const item = mediaStore?.mediaItems.find(m => m.id === id);
      if (item) {
        addAttachment({
          id: generateUUID(),
          mediaId: item.id,
          path: item.file?.path || item.url || '',
          name: item.name,
          type: item.type as 'image' | 'video' | 'audio',
          thumbnailUrl: item.thumbnailUrl,
          mimeType: item.file?.type || `${item.type}/*`,
        });
      }
    });
  },
});

// Wrap input area with drag props:
<div {...dragProps} className={cn("p-2 border-t", isDragOver && "ring-2 ring-primary bg-primary/5")}>
```

**Test Cases**:
- Test media item drag detection (application/x-media-item)
- Test conversion from MediaItem to AttachedFile
- Test external file drop handling
- Test drop zone visual feedback

---

### Subtask 7: Streaming Response Handler

**Description**: Implement real-time streaming of Gemini responses from the main process to the renderer, updating the UI progressively.

**Relevant Files**:
- `electron/gemini-chat-handler.ts` (MODIFY)
- `electron/preload.ts` (MODIFY - add to ElectronAPI interface around line 155-315)
- `apps/web/src/stores/gemini-terminal-store.ts` (MODIFY)

**Implementation Details**:

1. Main process streaming in `gemini-chat-handler.ts`:
```typescript
import { ipcMain, BrowserWindow } from "electron";

export function setupGeminiChatIPC(): void {
  ipcMain.handle('gemini:chat', async (event, request: GeminiChatRequest) => {
    try {
      const apiKey = await getGeminiApiKey(); // Reuse from transcribe handler
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: request.model || 'gemini-2.0-flash'
      });

      const contents = await formatRequestContents(request);
      const result = await model.generateContentStream(contents);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          event.sender.send('gemini:stream-chunk', { text });
        }
      }

      event.sender.send('gemini:stream-complete');
      return { success: true };
    } catch (error: any) {
      event.sender.send('gemini:stream-error', { message: error.message });
      return { success: false, error: error.message };
    }
  });

  console.log("[Gemini Chat] ✅ Chat handler registered");
}
```

2. Add to preload.ts ElectronAPI interface (around line 245):
```typescript
  // Gemini Chat operations
  geminiChat: {
    send: (request: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      attachments?: Array<{ path: string; mimeType: string; name: string }>;
      model?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    onStreamChunk: (callback: (data: { text: string }) => void) => void;
    onStreamComplete: (callback: () => void) => void;
    onStreamError: (callback: (data: { message: string }) => void) => void;
    removeListeners: () => void;
  };
```

3. Add implementation in preload.ts (around line 405):
```typescript
  // Gemini Chat operations
  geminiChat: {
    send: (request) => ipcRenderer.invoke('gemini:chat', request),
    onStreamChunk: (callback) => {
      ipcRenderer.on('gemini:stream-chunk', (_, data) => callback(data));
    },
    onStreamComplete: (callback) => {
      ipcRenderer.on('gemini:stream-complete', () => callback());
    },
    onStreamError: (callback) => {
      ipcRenderer.on('gemini:stream-error', (_, data) => callback(data));
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('gemini:stream-chunk');
      ipcRenderer.removeAllListeners('gemini:stream-complete');
      ipcRenderer.removeAllListeners('gemini:stream-error');
    },
  },
```

4. Store integration in `gemini-terminal-store.ts`:
```typescript
sendMessage: async (content: string) => {
  const { messages, pendingAttachments } = get();

  // Add user message immediately
  const userMessage: ChatMessage = {
    id: generateUUID(),
    role: 'user',
    content,
    attachments: [...pendingAttachments],
    timestamp: Date.now(),
  };

  set({
    messages: [...messages, userMessage],
    isStreaming: true,
    currentStreamingContent: '',
    pendingAttachments: [],
    error: null,
  });

  // Set up listeners
  window.electronAPI?.geminiChat?.onStreamChunk(({ text }) => {
    set(state => ({
      currentStreamingContent: state.currentStreamingContent + text
    }));
  });

  window.electronAPI?.geminiChat?.onStreamComplete(() => {
    const finalContent = get().currentStreamingContent;
    const assistantMessage: ChatMessage = {
      id: generateUUID(),
      role: 'assistant',
      content: finalContent,
      timestamp: Date.now(),
    };
    set(state => ({
      messages: [...state.messages, assistantMessage],
      isStreaming: false,
      currentStreamingContent: '',
    }));
    window.electronAPI?.geminiChat?.removeListeners();
  });

  window.electronAPI?.geminiChat?.onStreamError(({ message }) => {
    set({ isStreaming: false, error: message });
    window.electronAPI?.geminiChat?.removeListeners();
  });

  // Format attachments for IPC
  const attachments = pendingAttachments.map(att => ({
    path: att.path,
    mimeType: att.mimeType,
    name: att.name,
  }));

  await window.electronAPI?.geminiChat?.send({
    messages: [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content,
    })),
    attachments,
  });
},
```

**Test Cases**:
- Test chunk accumulation
- Test stream completion
- Test error handling during stream
- Test listener cleanup on unmount

---

### Subtask 8: File Attachment Encoding for Gemini API

**Description**: Implement utilities to read media files from disk and encode them for the Gemini API (base64 for images, frame extraction for videos).

**Relevant Files**:
- `electron/gemini-chat-handler.ts` (MODIFY)
- `electron/ffmpeg-handler.ts` (REFERENCE - for video frame extraction patterns)

**Implementation Details**:
```typescript
// electron/gemini-chat-handler.ts

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

async function encodeAttachment(attachment: FileAttachment): Promise<GeminiPart[]> {
  const buffer = await fs.readFile(attachment.path);

  if (attachment.mimeType.startsWith('image/')) {
    return [{
      inlineData: {
        mimeType: attachment.mimeType,
        data: buffer.toString('base64'),
      },
    }];
  }

  if (attachment.mimeType.startsWith('video/')) {
    // For videos, extract a few key frames using FFmpeg
    // Gemini 2.0 supports video natively, but for longer videos
    // we may want to extract frames
    const { extractVideoFrames } = require('./ffmpeg-handler.js');

    try {
      // Extract up to 5 frames evenly distributed
      const frames = await extractVideoFrames(attachment.path, 5);
      return frames.map((frameBase64: string) => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data: frameBase64,
        },
      }));
    } catch (error) {
      // Fallback: send first 10MB of video if frame extraction fails
      // Gemini 2.0 Flash supports up to 1 hour of video
      const maxSize = 10 * 1024 * 1024; // 10MB limit for inline
      const truncatedBuffer = buffer.subarray(0, maxSize);
      return [{
        inlineData: {
          mimeType: attachment.mimeType,
          data: truncatedBuffer.toString('base64'),
        },
      }];
    }
  }

  if (attachment.mimeType.startsWith('audio/')) {
    return [{
      inlineData: {
        mimeType: attachment.mimeType,
        data: buffer.toString('base64'),
      },
    }];
  }

  // Unsupported type - return text description
  return [{
    text: `[Attached file: ${attachment.name} (${attachment.mimeType})]`,
  }];
}

async function formatRequestContents(request: GeminiChatRequest): Promise<any[]> {
  const contents: any[] = [];

  for (const message of request.messages) {
    const parts: GeminiPart[] = [{ text: message.content }];
    contents.push({
      role: message.role === 'user' ? 'user' : 'model',
      parts,
    });
  }

  // Add attachments to the last user message
  if (request.attachments && request.attachments.length > 0) {
    const lastUserIndex = contents.findLastIndex(c => c.role === 'user');
    if (lastUserIndex >= 0) {
      for (const attachment of request.attachments) {
        const attachmentParts = await encodeAttachment(attachment);
        contents[lastUserIndex].parts.push(...attachmentParts);
      }
    }
  }

  return contents;
}
```

**Test Cases**:
- Test image encoding (JPEG, PNG, WebP)
- Test video frame extraction
- Test audio encoding (MP3, WAV)
- Test unsupported file type handling
- Test large file handling

---

### Subtask 9: Context Menu Actions for Media Items

**Description**: Add a context menu option to media items that sends them directly to Gemini for analysis (e.g., "Analyze with Gemini", "Describe this video").

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/media.tsx` (MODIFY - lines 413-479 for existing context menu)
- `apps/web/src/components/editor/media-panel/store.ts` (USE - setActiveTab)
- `apps/web/src/stores/gemini-terminal-store.ts` (USE)

**Implementation Details**:

Add after line 465 (after "Add as Overlay" menu item) in `media.tsx`:
```tsx
import { Sparkles } from "lucide-react";
import { useGeminiTerminalStore } from "@/stores/gemini-terminal-store";
import { generateUUID } from "@/lib/utils";

// Inside the component, add:
const { addAttachment, setInputValue } = useGeminiTerminalStore();

// In the ContextMenuContent, add after the "Add as Overlay" item:
<ContextMenuItem
  onClick={(e) => {
    e.stopPropagation();

    // Switch to Gemini tab
    setActiveTab('gemini');

    // Add media as attachment
    addAttachment({
      id: generateUUID(),
      mediaId: item.id,
      path: item.file?.path || item.url || '',
      name: item.name,
      type: item.type as 'image' | 'video' | 'audio',
      thumbnailUrl: item.thumbnailUrl,
      mimeType: item.file?.type || `${item.type}/*`,
    });

    // Pre-fill prompt based on media type
    const prompt = item.type === 'video'
      ? 'Describe what happens in this video:'
      : item.type === 'audio'
      ? 'Transcribe and summarize this audio:'
      : 'Describe this image in detail:';
    setInputValue(prompt);

    toast.success(`"${item.name}" ready for Gemini analysis`);
  }}
>
  <Sparkles className="h-4 w-4 mr-2" aria-hidden="true" />
  Analyze with Gemini
</ContextMenuItem>
```

**Test Cases**:
- Test context menu appears with new option
- Test tab switching to Gemini
- Test attachment addition
- Test prompt pre-fill for different media types

---

### Subtask 10: Type Definitions Update

**Description**: Update TypeScript definitions for the new Gemini chat API.

**Relevant Files**:
- `electron/preload.ts` (MODIFY - update ElectronAPI interface)
- `apps/web/src/types/electron.d.ts` (MODIFY - add GeminiChat types for renderer)

**Implementation Details**:

Add to `apps/web/src/types/electron.d.ts` (around line 275, before the closing of ElectronAPI):
```typescript
  // Gemini Chat operations
  geminiChat?: {
    send: (request: {
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
    }) => Promise<{ success: boolean; error?: string }>;
    onStreamChunk: (callback: (data: { text: string }) => void) => void;
    onStreamComplete: (callback: () => void) => void;
    onStreamError: (callback: (data: { message: string }) => void) => void;
    removeListeners: () => void;
  };
```

Note: The `?` optional marker allows the renderer to check if Gemini chat is available before using it.

---

## Implementation Order

1. **Subtask 1**: Electron IPC Handler (foundation)
2. **Subtask 10**: Type Definitions (enables type-safe development)
3. **Subtask 2**: Zustand Store (state management)
4. **Subtask 3**: Tab Registration (UI entry point)
5. **Subtask 5**: Message Components (UI building blocks)
6. **Subtask 4**: Terminal View Component (main UI)
7. **Subtask 6**: Drag-and-Drop Integration (core feature)
8. **Subtask 7**: Streaming Response Handler (UX improvement)
9. **Subtask 8**: File Attachment Encoding (multimodal support)
10. **Subtask 9**: Context Menu Actions (convenience feature)

---

## Testing Strategy

### Unit Tests
- All new stores: `apps/web/src/stores/__tests__/gemini-terminal-store.test.ts`
- Custom hooks: `apps/web/src/hooks/__tests__/use-media-drop.test.ts`

### Component Tests
- Terminal view: `apps/web/src/components/editor/media-panel/views/__tests__/gemini-terminal.test.tsx`
- Message components: `apps/web/src/components/editor/media-panel/views/gemini-terminal/__tests__/message-item.test.tsx`

### Integration Tests
- Full chat flow with mocked Electron API
- Drag-and-drop from media panel to terminal
- Streaming response display

### Manual Testing Checklist
- [ ] Send text message and receive response
- [ ] Drag image from media panel, send with prompt
- [ ] Drag video, verify frame extraction works
- [ ] Test streaming response display (characters appear progressively)
- [ ] Test error handling (no API key, network error)
- [ ] Test keyboard navigation (Tab, Enter, Escape)
- [ ] Test screen reader compatibility (role="log", aria-labels)
- [ ] Test context menu "Analyze with Gemini" action
- [ ] Test tab switching and attachment persistence

---

## Dependencies

### Already Installed (in apps/web/package.json)
- `@google/generative-ai` - Gemini SDK
- `react-markdown` v10.1.0 - Markdown rendering
- `rehype-sanitize` v6.0.0 - HTML sanitization
- `lucide-react` - Icons (TerminalIcon, Send, Bot, User, etc.)
- `zustand` - State management

### No New Dependencies Required

---

## Security Considerations

1. **API Key Storage**: Reuse existing secure storage from `api-key-handler.ts` (lines 96-186 in gemini-transcribe-handler.ts show the pattern)
2. **File Access**: Only allow access to files already in the media panel (validated by mediaId)
3. **Response Sanitization**: Use `rehype-sanitize` plugin with ReactMarkdown
4. **Input Validation**: Validate attachment paths exist before reading

---

## Performance Considerations

1. **Lazy Loading**: The view is already part of the media panel's viewMap, loaded on tab switch
2. **Message Virtualization**: Consider `@tanstack/react-virtual` for long chat histories (future enhancement)
3. **Attachment Thumbnails**: Reuse existing thumbnails from MediaItem
4. **Streaming Chunks**: UI updates on each chunk; React batches these automatically
5. **File Size Limits**: Limit inline media to 10MB; use frame extraction for large videos

---

## Future Enhancements

1. **Action Execution**: Allow Gemini to suggest and execute timeline operations
2. **Voice Input**: Add speech-to-text for voice commands
3. **Conversation Persistence**: Save chat history per project in storage
4. **Custom Prompts**: User-defined prompt templates for common tasks
5. **Multi-model Support**: Allow switching between Gemini models (Flash, Pro)
6. **Function Calling**: Use Gemini's function calling to interact with timeline

---

## Related Documentation

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Gemini 2.0 Flash Capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-v2)
- [QCut CLAUDE.md](../../../CLAUDE.md) - Project conventions and accessibility rules
