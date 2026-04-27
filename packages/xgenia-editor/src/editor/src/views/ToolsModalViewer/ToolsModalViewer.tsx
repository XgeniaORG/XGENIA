import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@xgenia-core-ui/components/layout/Modal';
import { ToolMetadata } from '../../models/ToolsModel';
import { ProjectModel } from '../../models/projectmodel';
import css from './ToolsModalViewer.module.scss';

interface ToolsModalViewerProps {
  tool: ToolMetadata | null;
  isVisible: boolean;
  onClose: () => void;
  onToolResult?: (result: any) => void;
}

export function ToolsModalViewer({ tool, isVisible, onClose, onToolResult }: ToolsModalViewerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!tool || !isVisible) {
      setError(null);
      setIsLoading(false);
      return;
    }

    loadTool();
    
    // Set up message communication with the tool
    const handleMessage = (event: MessageEvent) => {
      console.log('[ToolsModalViewer] Received message from origin:', event.origin, 'Data:', event.data);
      
      const port = process.env.XGENIAPORT || 8574;
      if (event.origin !== `http://localhost:${port}`) {
        console.log('[ToolsModalViewer] Ignoring message from wrong origin:', event.origin);
        return;
      }
      
      const { type, data } = event.data;
      console.log('[ToolsModalViewer] Processing message type:', type || event.data?.type);
      
      switch (type || event.data?.type) {
        case 'tool-ready':
          console.log('[ToolsModalViewer] Tool is ready:', event.data.componentName);
          setIsLoading(false);
          break;
          
        case 'tool-status':
          console.log('[ToolsModalViewer] Tool status update:', event.data.status);
          if (event.data.status === 'loaded') {
            setIsLoading(false);
          }
          break;
          
        case 'tool-result':
          console.log('[ToolsModalViewer] Received tool result:', data || event.data.result);
          onToolResult?.(data || event.data.result);
          // Don't auto-close, let user decide
          break;
          
        case 'tool-close':
          console.log('[ToolsModalViewer] Tool requested close');
          onClose();
          break;
          
        case 'tool-error':
          console.error('[ToolsModalViewer] Tool error:', data || event.data.message);
          setError((data && data.message) || event.data.message || 'Tool error occurred');
          break;

        case 'tool-html-loaded':
          console.log('[ToolsModalViewer] Tool HTML has loaded:', event.data.toolId);
          // This message indicates the basic HTML structure is loaded.
          // We typically wait for 'tool-ready' or 'tool-status: loaded' 
          // to confirm all scripts are initialized before hiding the loader.
          break;
          
        case 'editor-api-call':
          console.log('[ToolsModalViewer] Tool requesting editor API call:', event.data);
          handleEditorApiCall(event.data);
          break;
          
        default:
          console.log('[ToolsModalViewer] Unknown message type:', type || event.data?.type, 'Full event data:', event.data);
      }
    };

    window.addEventListener('message', handleMessage);
    console.log('[ToolsModalViewer] Message listener added');
    
    // Cleanup listener when component unmounts or tool changes
    return () => {
      window.removeEventListener('message', handleMessage);
      console.log('[ToolsModalViewer] Message listener removed');
    };
  }, [tool, isVisible]);

  const handleEditorApiCall = (apiCallData: any) => {
    console.log('[ToolsModalViewer] Handling editor API call:', apiCallData);
    
    // For now, just send a success response back to the tool
    // In a full implementation, this would forward to the actual editor API
    const response = {
      type: 'editor-api-response',
      token: apiCallData.token,
      response: {
        success: true,
        api: apiCallData.api,
        result: `API call ${apiCallData.api} handled successfully`
      }
    };
    
    // Send response back to the tool iframe
    if (iframeRef.current && iframeRef.current.contentWindow) {
      console.log('[ToolsModalViewer] Sending API response back to tool:', response);
      iframeRef.current.contentWindow.postMessage(response, '*');
    }
  };

  const loadTool = async () => {
    if (!tool) return;

    setIsLoading(true);
    setError(null);

    try {
      // Create the tool URL for the embedded viewer
      const port = process.env.XGENIAPORT || 8574;
      const baseUrl = `http://localhost:${port}/external/tools/`;
      const toolParams = new URLSearchParams({
        component: tool.componentName,
        toolId: tool.id,
        mode: 'tool'
      });
      
      const toolUrl = `${baseUrl}?${toolParams.toString()}`;
      
      console.log(`[ToolsModalViewer] Loading tool: ${tool.name} (${tool.componentName})`);
      console.log(`[ToolsModalViewer] Tool URL: ${toolUrl}`);

      // Load the tool in the iframe
      if (iframeRef.current) {
        iframeRef.current.src = toolUrl;
      }

      // Don't set loading to false here - wait for tool-ready message
      console.log('[ToolsModalViewer] Iframe src set, waiting for tool-ready message to hide loading...');
    } catch (err: any) {
      console.error('[ToolsModalViewer] Error loading tool:', err);
      setError(err instanceof Error ? err.message : 'Failed to load tool');
      setIsLoading(false);
    }
  };

  const handleIframeLoad = () => {
    console.log('[ToolsModalViewer] Iframe loaded. Tools project should have all required scripts.');
    // No need to inject scripts anymore since we're serving the tools project
    // as a full XGENIA project with all modules and runtime included
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setError('Failed to load tool viewer');
  };

  if (!tool) {
    return null;
  }

  return (
    <Modal
      isVisible={isVisible}
      onClose={onClose}
      title={tool.name}
      subtitle={tool.description}
      UNSAFE_className={css.toolsModal}
    >
      <div className={css.toolContainer}>
        {isLoading && (
          <div className={css.loadingContainer}>
            <div className={css.spinner} />
            <p>Loading {tool.name}...</p>
          </div>
        )}
        
        {error && (
          <div className={css.errorContainer}>
            <h3>Error Loading Tool</h3>
            <p>{error}</p>
            <button onClick={loadTool} className={css.retryButton}>
              Retry
            </button>
          </div>
        )}
        
        {!error && (
          <iframe
            ref={iframeRef}
            className={css.toolIframe}
            style={{ display: isLoading ? 'none' : 'block' }}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            title={`${tool.name} Tool`}
          />
        )}
      </div>
    </Modal>
  );
}
 