import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';

// Debug: Listen for all EventDispatcher events globally
if (typeof window !== 'undefined') {
  const originalEmit = EventDispatcher.instance.emit;
  EventDispatcher.instance.emit = function(event: string, ...args: any[]) {
    console.log('[EventDispatcher] 📡 Emitting event:', event, ...args);
    return originalEmit.call(this, event, ...args);
  };
}

interface InlineElementChatProps {
  nodeId: string;
  nodeLabel: string;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * InlineElementChat - Shows a small chat popup directly on the canvas
 * when an element is clicked in inspect mode
 */
export const InlineElementChat: React.FC<InlineElementChatProps> = ({
  nodeId,
  nodeLabel,
  position,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [chatPosition, setChatPosition] = useState(position);
  const [inputValue, setInputValue] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adjust position to ensure chat stays within viewport
  useEffect(() => {
    if (chatRef.current) {
      const rect = chatRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = position.x;
      let newY = position.y;

      // Keep chat within horizontal bounds
      if (newX + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 20;
      }
      if (newX < 20) {
        newX = 20;
      }

      // Keep chat within vertical bounds
      if (newY + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 20;
      }
      if (newY < 20) {
        newY = 20;
      }

      setChatPosition({ x: newX, y: newY });
    }
  }, [position]);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, 200); // Allow fade animation
  }, [onClose]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (chatRef.current && !chatRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClose]);

  // Focus the input when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const message = inputValue.trim();
    if (message) {
      console.log('[InlineElementChat] 📤 Sending message to main chat:', {
        message,
        nodeId,
        nodeLabel
      });

      // Send message to main chat via EventDispatcher
      EventDispatcher.instance.emit('inline-chat-message', {
        message,
        nodeId,
        nodeLabel,
        timestamp: Date.now()
      });

      console.log('[InlineElementChat] ✅ Event emitted, closing popup');
      handleClose(); // Close the popup after sending
    }
  }, [inputValue, nodeId, nodeLabel, handleClose]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  }, [handleSubmit]);

  if (!isVisible) return null;

  // Create portal to render at document body level
  return createPortal(
    <div
      ref={chatRef}
      className="inline-element-chat"
      style={{
        position: 'fixed',
        left: chatPosition.x,
        top: chatPosition.y,
        zIndex: 10000,
        pointerEvents: 'auto'
      }}
    >
      <div
        className="inline-chat-container"
        style={{
          backgroundColor: '#272625',
          borderRadius: '6px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(67, 222, 146, 0.3)',
          width: '280px',
          height: '50px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          animation: 'inlineChatFadeIn 0.15s ease-out'
        }}
      >
        {/* Simple Input Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%'
          }}
        >
          <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', gap: '6px' }}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Edit ${nodeLabel}...`}
              style={{
                flex: 1,
                padding: '6px 10px',
                border: '1px solid rgba(67, 222, 146, 0.3)',
                borderRadius: '4px',
                backgroundColor: '#2a2a2a',
                color: '#ffffff',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'inherit'
              }}
              autoFocus
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              style={{
                padding: '6px 12px',
                backgroundColor: '#43de92',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                opacity: inputValue.trim() ? 1 : 0.5
              }}
              title="Send (Enter)"
            >
              Send
            </button>
          </form>

          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '3px',
              fontSize: '14px',
              lineHeight: '1'
            }}
            title="Cancel (Esc)"
          >
            ×
          </button>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes inlineChatFadeIn {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .inline-element-chat {
          animation: inlineChatFadeIn 0.2s ease-out;
        }

        .inline-element-chat.fade-out {
          animation: inlineChatFadeOut 0.2s ease-in forwards;
        }

        @keyframes inlineChatFadeOut {
          from {
            opacity: 1;
            transform: scale(1);
          }
          to {
            opacity: 0;
            transform: scale(0.9);
          }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default InlineElementChat;
