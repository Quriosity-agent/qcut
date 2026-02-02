"use client";

import { useGeminiTerminalStore } from "@/stores/gemini-terminal-store";
import { useAsyncMediaStore } from "@/hooks/use-async-media-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Trash2, Loader2, AlertCircle } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import { MessageItem } from "./gemini-terminal/message-item";
import { AttachmentPreview } from "./gemini-terminal/attachment-preview";
import { cn } from "@/lib/utils";
import { generateUUID } from "@/lib/utils";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";
import { toast } from "sonner";
import type { AttachedFile } from "@/stores/gemini-terminal-store";

export function GeminiTerminalView() {
  const {
    messages,
    isStreaming,
    currentStreamingContent,
    pendingAttachments,
    inputValue,
    error,
    setInputValue,
    sendMessage,
    addAttachment,
    removeAttachment,
    clearHistory,
  } = useGeminiTerminalStore();

  const { store: mediaStore } = useAsyncMediaStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      // ScrollArea forwards ref to Root (overflow: hidden), not the Viewport
      // Query for the actual scrollable element using Radix's data attribute
      const viewport = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement | null;
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() && pendingAttachments.length === 0) return;
    await sendMessage(inputValue);
  }, [inputValue, pendingAttachments.length, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Drag and drop handlers for media items from the media panel
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;

    // Only show drop zone for internal media items (not external files)
    // External file drops are not currently supported
    if (e.dataTransfer.types.includes("application/x-media-item")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      dragCounterRef.current = 0;

      // Handle internal media item drop
      const mediaData = e.dataTransfer.getData("application/x-media-item");
      if (mediaData) {
        try {
          const { id } = JSON.parse(mediaData);
          const item = mediaStore?.mediaItems.find((m) => m.id === id);
          if (item) {
            const filePath = item.localPath || item.url;

            if (!filePath || filePath.startsWith("blob:")) {
              toast.error(
                "This media item doesn't have a local file path for Gemini analysis."
              );
              return;
            }

            const attachment: AttachedFile = {
              id: generateUUID(),
              mediaId: item.id,
              path: filePath,
              name: item.name,
              type: item.type as "image" | "video" | "audio",
              thumbnailUrl: item.thumbnailUrl,
              mimeType: item.file?.type || `${item.type}/*`,
            };
            addAttachment(attachment);
          }
        } catch (err) {
          handleError(err, {
            operation: "Parse media drag data",
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.LOW,
          });
        }
      }
    },
    [mediaStore?.mediaItems, addAttachment]
  );

  const dragProps = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-sm font-medium">Gemini Chat</span>
        <Button
          type="button"
          variant="text"
          size="sm"
          onClick={clearHistory}
          disabled={messages.length === 0 || isStreaming}
          aria-label="Clear chat history"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Message List */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
          className="p-3"
        >
          {messages.length === 0 && !isStreaming && (
            <div className="text-center text-muted-foreground py-8">
              <p className="text-sm">Start a conversation with Gemini</p>
              <p className="text-xs mt-2">
                Drag media from the panel to analyze it
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}

          {isStreaming && currentStreamingContent && (
            <MessageItem
              message={{
                id: "streaming",
                role: "assistant",
                content: currentStreamingContent,
                timestamp: Date.now(),
              }}
              isStreaming
            />
          )}

          {isStreaming && !currentStreamingContent && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mr-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 p-2 mx-2 mb-2 bg-destructive/10 text-destructive rounded-md text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="line-clamp-2">{error}</span>
        </div>
      )}

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

      {/* Input Area with Drop Zone */}
      <div
        {...dragProps}
        className={cn(
          "p-2 border-t transition-colors",
          isDragOver && "ring-2 ring-primary ring-inset bg-primary/5"
        )}
      >
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isDragOver
                ? "Drop media here..."
                : "Ask Gemini about your media..."
            }
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={isStreaming}
            aria-label="Chat message input"
          />
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isStreaming ||
              (!inputValue.trim() && pendingAttachments.length === 0)
            }
            aria-label="Send message"
            className="self-end"
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
