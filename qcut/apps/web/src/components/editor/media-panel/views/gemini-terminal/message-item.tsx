"use client";

import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { AttachmentPreview } from "./attachment-preview";
import type { ChatMessage } from "@/stores/gemini-terminal-store";

interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageItem({ message, isStreaming }: MessageItemProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg mb-2",
        message.role === "user" ? "bg-primary/10 ml-8" : "bg-muted mr-8"
      )}
    >
      {/* Role indicator */}
      <div className="flex items-center gap-2 mb-1">
        {message.role === "user" ? (
          <User className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Bot className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="text-xs text-muted-foreground">
          {message.role === "user" ? "You" : "Gemini"}
        </span>
      </div>

      {/* Attachments if any */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {message.attachments.map((att) => (
            <AttachmentPreview key={att.id} attachment={att} compact />
          ))}
        </div>
      )}

      {/* Message content with markdown */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_pre]:my-2 [&_code]:text-xs [&_pre]:bg-background/50 [&_pre]:p-2 [&_pre]:rounded">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
          {message.content}
        </ReactMarkdown>
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <span
          className="inline-block w-2 h-4 bg-foreground animate-pulse ml-1"
          aria-label="Generating response..."
        />
      )}
    </div>
  );
}
