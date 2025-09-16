import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TextInputModalProps {
  isOpen: boolean;
  position: { x: number; y: number };
  fontSize: number;
  color: string;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}

export const TextInputModal: React.FC<TextInputModalProps> = ({
  isOpen,
  position,
  fontSize,
  color,
  onConfirm,
  onCancel
}) => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setText('');
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (text.trim()) {
      onConfirm(text.trim());
    } else {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-4 min-w-[300px]"
        style={{
          position: 'absolute',
          left: Math.min(position.x, window.innerWidth - 320),
          top: Math.min(position.y, window.innerHeight - 200),
        }}
      >
        <div className="space-y-4">
          <h3 className="text-white font-medium">Add Text</h3>

          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your text..."
            className={cn(
              "w-full bg-gray-700 border border-gray-600 rounded px-3 py-2",
              "text-white placeholder-gray-400 resize-none",
              "focus:outline-none focus:border-orange-500"
            )}
            style={{
              fontSize: `${Math.max(12, Math.min(fontSize, 24))}px`,
              color: color,
              minHeight: '80px'
            }}
            rows={3}
          />

          <div className="text-xs text-gray-400">
            Press Enter to confirm, Shift+Enter for new line, Esc to cancel
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="text"
              size="sm"
              onClick={onCancel}
              className="text-gray-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!text.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              Add Text
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TextInputModal;