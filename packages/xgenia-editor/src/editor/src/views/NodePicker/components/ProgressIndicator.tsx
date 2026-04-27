import React, { useEffect, useState } from 'react';

export default function ProgressIndicator({ isLoading }: { isLoading: boolean }) {
  // Loading progress state
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Handle loading progress animation
  useEffect(() => {
    if (isLoading) {
      setLoadingProgress(0);
      setLoadingMessage('Connecting to MCP server...');

      const startTime = Date.now();
      const duration = 3500; // 2 seconds total
      const messages = [
        'Connecting to MCP server...',
        'Discovering available tools...',
        'Loading tool definitions...',
        'Almost ready...'
      ];
      let messageIndex = 0;

      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / duration) * 100, 95); // Cap at 95% until actually done

        setLoadingProgress(progress);

        // Update message every 500ms
        if (elapsed > messageIndex * 500 && messageIndex < messages.length - 1) {
          messageIndex++;
          setLoadingMessage(messages[messageIndex]);
        }
      }, 50); // Update every 50ms for smooth animation

      return () => clearInterval(interval);
    } else {
      // Complete the progress when loading is done
      setLoadingProgress(100);
      setLoadingMessage('Tools loaded successfully!');

      // Reset after a short delay
      setTimeout(() => {
        setLoadingProgress(0);
        setLoadingMessage('');
      }, 500);
    }
  }, [isLoading]);

  return (
    <div className="text-center">
      {/* Progress Bar */}
      <div className="w-64 h-2 bg-gray-700 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${loadingProgress}%` }}
        />
      </div>

      {/* Loading Message */}
      <div className="text-gray-400 text-sm mb-2">{loadingMessage}</div>

      {/* Subtitle */}
      <div className="text-gray-500 text-xs">This will take just a moment...</div>
    </div>
  );
}
