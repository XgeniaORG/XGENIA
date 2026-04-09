import React, { useState, useEffect } from 'react';

interface ToolsModalViewerProps {
  tool: any;
  onClose: () => void;
}

const ToolsModalViewer: React.FC<ToolsModalViewerProps> = ({ tool, onClose }) => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our iframe origin
      if (event.origin !== `http://localhost:${process.env.XGENIAPORT || 8574}`) {
        return;
      }
      
      console.log('[ToolsModalViewer] Received message from tool:', event.data);
      
      // Handle different message types from the tool
      if (event.data?.type === 'tool-ready') {
        console.log(`[ToolsModalViewer] Tool "${event.data.componentName}" is ready`);
        setLoading(false);
        // Tool has loaded and is ready for interaction
      } else if (event.data?.type === 'tool-status') {
        console.log(`[ToolsModalViewer] Tool status: ${event.data.status}`);
        if (event.data.status === 'loaded') {
          setLoading(false);
        }
        // Tool is reporting its status (loaded, error, etc.)
      } else if (event.data?.type === 'tool-result') {
        console.log('[ToolsModalViewer] Tool produced a result:', event.data.result);
        // Tool has produced a result that we might want to integrate back into the main project
      } else {
        console.log('[ToolsModalViewer] Unknown message type:', event.data?.type);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!tool) {
    return null;
  }

  console.log('[ToolsModalViewer] Loading tool:', tool.name, `(${tool.componentName})`);
  const port = process.env.XGENIAPORT || 8574;
  const toolUrl = `http://localhost:${port}/external/tools/?component=${encodeURIComponent(tool.componentName)}&toolId=${tool.id}&mode=tool`;
  console.log('[ToolsModalViewer] Tool URL:', toolUrl);

  const handleClose = () => {
    console.log('[ToolsModalViewer] Closing tool modal');
    onClose();
  };

  const handleIframeLoad = () => {
    console.log('[ToolsModalViewer] Iframe loaded');
    // Don't set loading to false here immediately, wait for tool-ready message
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={handleClose}
    >
      <div 
        style={{
          width: '90%',
          height: '90%',
          backgroundColor: 'white',
          borderRadius: '8px',
          position: 'relative',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px 8px 0 0'
        }}>
          <h3 style={{ margin: 0, color: '#333' }}>
            {tool.name}
          </h3>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#666',
              padding: '4px 8px'
            }}
          >
            ×
          </button>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1001,
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ 
                display: 'inline-block',
                width: '20px',
                height: '20px',
                border: '2px solid #5836F5',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '10px'
              }} />
              <div>Loading {tool.name}...</div>
            </div>
          </div>
        )}

        {/* Tool iframe */}
        <iframe
          src={toolUrl}
          style={{
            width: '100%',
            height: 'calc(100% - 60px)',
            border: 'none',
            borderRadius: '0 0 8px 8px'
          }}
          onLoad={handleIframeLoad}
          title={`XGENIA Tool: ${tool.name}`}
        />
      </div>

      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default ToolsModalViewer; 