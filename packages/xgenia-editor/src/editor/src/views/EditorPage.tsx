import React, { useState, useEffect, useCallback } from 'react';
import { CommandPalette } from './CommandPalette/CommandPalette';
import { ToolsModalViewer } from './ToolsModalViewer/ToolsModalViewer';
import { ToolsModel, ToolMetadata, ToolsModelEvent } from '../models/ToolsModel';
import { ProjectModel } from '../models/projectmodel'; // Assuming this might be needed later or was there

// Placeholder for other editor components/styles if any were there
// import TopBar from './TopBar'; 
// import SideBar from './SideBar';
// import Canvas from './Canvas';
// import StatusBar from './StatusBar';
// import styles from './EditorPage.module.scss';


const EditorPage: React.FC = () => {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [xgeniaTools, setXgeniaTools] = useState<ToolMetadata[]>([]);
  
  const [isToolsModalVisible, setIsToolsModalVisible] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolMetadata | null>(null);

  // Initialize ToolsModel and load tools
  useEffect(() => {
    const initTools = async () => {
      console.log('[EditorPage] Initializing ToolsModel and scanning for tools...');
      try {
        await ToolsModel.instance.scanToolsProject();
        setXgeniaTools([...ToolsModel.instance.tools]); // Create a mutable copy
        console.log('[EditorPage] Tools loaded:', ToolsModel.instance.tools);
      } catch (error: any) {
        console.error('[EditorPage] Error initializing tools:', error);
      }
    };
    initTools();

    const handleToolsLoaded = (loadedTools: ToolMetadata[]) => {
      console.log('[EditorPage] ToolsModel ToolsLoaded event, refreshing tools list.');
      setXgeniaTools([...loadedTools]); // Create new array from payload
    };
    
    ToolsModel.instance.on(ToolsModelEvent.ToolsLoaded, handleToolsLoaded);
    
    return () => {
      // Attempting to use off with event name and listener. 
      // If this fails due to strict d.ts, we may need to use removeAllListeners() or manage groups.
      try {
        (ToolsModel.instance.off as any)(ToolsModelEvent.ToolsLoaded, handleToolsLoaded);
      } catch (e: any) {
        console.warn('[EditorPage] Could not specifically call off(event, listener), falling back or investigate grouping. Error:', e);
        // As a last resort if specific off isn't available and causing issues:
        // ToolsModel.instance.removeAllListeners(); 
      }
    };
  }, []);

  // CMD+K handler
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      console.log('[EditorPage] CMD+K handler triggered.');
      setXgeniaTools([...ToolsModel.instance.tools]); // Create a mutable copy
      setIsCommandPaletteOpen(true);
      console.log('[EditorPage] CommandPalette open state set to true.');
    }
  }, []); // Removed isCommandPaletteOpen from deps, opening should always be possible

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Command Palette handlers
  const handleCloseCommandPalette = () => {
    setIsCommandPaletteOpen(false);
    console.log('[EditorPage] CommandPalette closed.');
  };

  const handleXgeniaToolSelected = (tool: ToolMetadata) => {
    console.log('[EditorPage] XGENIA tool selected from CommandPalette:', tool);
    setSelectedTool(tool);
    setIsToolsModalVisible(true);
    setIsCommandPaletteOpen(false); // Close palette after selection
  };
  
  // Tools Modal Viewer handlers
  const handleToolsModalClose = () => {
    setIsToolsModalVisible(false);
    setSelectedTool(null);
    console.log('[EditorPage] ToolsModalViewer closed.');
  };

  const handleToolResult = (result: any) => {
    console.log('[EditorPage] Received tool result:', result);
    // Process the result (e.g., add to canvas, update project data)
    // For now, just log it.
    // Example: if (ProjectModel.instance.currentProject) {
    //   ProjectModel.instance.currentProject.addAssetFromResult(result);
    // }
    // Optionally close the modal after getting a result, or let the tool close itself.
    // setIsToolsModalVisible(false); 
    // setSelectedTool(null);
  };

  // Log changes to isCommandPaletteOpen for debugging
  useEffect(() => {
    console.log('[EditorPage] isCommandPaletteOpen state changed to:', isCommandPaletteOpen);
  }, [isCommandPaletteOpen]);

  return (
    <div /*className={styles.editorLayout}*/>
      {/* TODO: Add other editor layout components like TopBar, SideBar, Canvas, StatusBar */}
      {/* <TopBar /> */}
      {/* <div className={styles.mainContent}> */}
        {/* <SideBar /> */}
        {/* <Canvas /> */}
      {/* </div> */}
      {/* <StatusBar /> */}
      
      <p style={{color: 'white', padding: '20px', fontSize: '18px', textAlign: 'center'}}>
        XGENIA Editor Page Content (Press CMD+K for Tools)
        <br />
        Command Palette Open: {isCommandPaletteOpen.toString()}
        <br />
        Tools Modal Visible: {isToolsModalVisible.toString()}
        <br />
        Selected Tool: {selectedTool ? selectedTool.name : 'None'}
        <br />
        Discovered XGENIA Tools Count: {xgeniaTools.length}
      </p>

      {isCommandPaletteOpen && (
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={handleCloseCommandPalette}
          tools={[]} // For original generic tools/actions if any
          xgeniaTools={xgeniaTools} // Pass the dynamic list of XGENIA tools
          onXgeniaToolSelected={handleXgeniaToolSelected}
          // onToolSelected={handleGenericToolSelected} // If you have other types of tools
        />
      )}

      {selectedTool && (
        <ToolsModalViewer
          tool={selectedTool}
          isVisible={isToolsModalVisible}
          onClose={handleToolsModalClose}
          onToolResult={handleToolResult}
        />
      )}
    </div>
  );
};

export default EditorPage; 