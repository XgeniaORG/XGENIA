const path = require('path');
const fs = require('fs');

console.log('🔥 TOOLS CONFIG JS FILE LOADED - THIS SHOULD APPEAR IF CHANGES ARE ACTIVE 🔥');

class ToolsConfig {
  constructor() {
    this.toolsProjectPath = null;
    this.tools = [];
    this.categories = [];
    this.loadToolsProjectPath();
    this.scanToolsProject();
  }

  loadToolsProjectPath() {
    this.toolsProjectPath = null;
  }

  scanToolsProject() {
    console.log('[ToolsConfig] scanToolsProject: Called.');
    
    if (!this.toolsProjectPath) {
      console.warn('[ToolsConfig] scanToolsProject: No tools project path available.');
      this.tools = [];
      this.categories = [];
      return;
    }

    try {
      const projectJsonPath = path.join(this.toolsProjectPath, 'project.json');
      
      if (!fs.existsSync(projectJsonPath)) {
        console.warn(`[ToolsConfig] scanToolsProject: project.json not found at: ${projectJsonPath}`);
        this.tools = [];
        this.categories = [];
        return;
      }

      console.log('[ToolsConfig] scanToolsProject: Reading tools project from:', projectJsonPath);
      const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      
      console.log('[ToolsConfig] scanToolsProject: Project data loaded. Components found:', projectData.components?.length || 0);
      
      if (!projectData.components || !Array.isArray(projectData.components)) {
        console.warn('[ToolsConfig] scanToolsProject: No components array found in tools project.json');
        this.tools = [];
        this.categories = [];
        return;
      }

      const discoveredTools = [];
      const categories = new Set();

      for (const component of projectData.components) {
        const componentName = component.name;
        console.log(`[ToolsConfig] scanToolsProject: Processing component: ${componentName}`);
        
        if (componentName === '/App' || componentName === '/Start Page') {
          console.log(`[ToolsConfig] scanToolsProject: Skipping system component: ${componentName}`);
          continue;
        }

        const isToolComponent = componentName.startsWith('/Tool_') || 
                               this.isAcceptableToolComponent(componentName);

        console.log(`[ToolsConfig] scanToolsProject: Component ${componentName} - isToolComponent: ${isToolComponent}`);

        if (isToolComponent) {
          const toolMetadata = this.extractToolMetadata(component);
          if (toolMetadata) {
            console.log(`[ToolsConfig] scanToolsProject: Added tool: ${toolMetadata.name} (${toolMetadata.componentName})`);
            discoveredTools.push(toolMetadata);
            if (toolMetadata.category) {
              categories.add(toolMetadata.category);
            }
          }
        }
      }

      this.tools = discoveredTools;
      this.categories = Array.from(categories);
      
      console.log(`[ToolsConfig] scanToolsProject: Discovered ${this.tools.length} tools:`, 
                  this.tools.map(t => t.name));

    } catch (error) {
      console.error('[ToolsConfig] scanToolsProject: Error during scanning:', error);
      this.tools = [];
      this.categories = [];
    }
  }

  isAcceptableToolComponent(componentName) {
    const acceptablePatterns = [
      '/Create Image',
      '/Create Image2', 
      '/Calculate',
      '/Generate Image',
      '/Generate Audio',
    ];
    const toolKeywords = ['create', 'generate', 'edit', 'convert', 'process', 'tool'];
    const lowerName = componentName.toLowerCase();
    
    const matchesPattern = acceptablePatterns.includes(componentName);
    const matchesKeyword = toolKeywords.some(keyword => lowerName.includes(keyword));
    
    console.log(`[ToolsConfig] isAcceptableToolComponent: ${componentName} -> pattern: ${matchesPattern}, keyword: ${matchesKeyword}`);
    
    return matchesPattern || matchesKeyword;
  }

  extractToolMetadata(component) {
    if (!component.name) {
      return null;
    }
    
    let friendlyName = component.name;
    if (friendlyName.startsWith('/')) friendlyName = friendlyName.substring(1);
    if (friendlyName.startsWith('Tool_')) friendlyName = friendlyName.substring(5);
    friendlyName = friendlyName.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim();
    friendlyName = friendlyName.replace(/\b\w/g, l => l.toUpperCase());
    
    let category = 'General';
    const name = component.name.toLowerCase();
    if (name.includes('create') || name.includes('generate') || name.includes('image')) category = 'Creation';
    else if (name.includes('edit') || name.includes('modify')) category = 'Editing';
    else if (name.includes('calculate') || name.includes('math')) category = 'Calculation';
    else if (name.includes('convert') || name.includes('transform')) category = 'Conversion';
    else if (name.includes('analysis') || name.includes('analyze')) category = 'Analysis';
    
    const toolId = component.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    let description = `${friendlyName} tool`;
    let icon = '🛠️';
    
    if (component.metadata) {
      description = component.metadata.description || description;
      icon = component.metadata.icon || icon;
    }
    
    return { 
      id: toolId, 
      name: friendlyName, 
      description, 
      category, 
      componentName: component.name, 
      icon 
    };
  }

  getTools() {
    return this.tools;
  }

  getCategories() {
    return this.categories;
  }

  getToolsProjectPath() {
    return this.toolsProjectPath;
  }

  setToolsProjectPath(newPath) {
    this.toolsProjectPath = newPath;
    this.scanToolsProject();
  }
}

// Create a singleton instance
const toolsConfig = new ToolsConfig();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = toolsConfig;
}

// Also make it available globally for debugging
if (typeof window !== 'undefined') {
  window.toolsConfig = toolsConfig;
} else if (typeof global !== 'undefined') {
  global.toolsConfig = toolsConfig;
}

console.log('[ToolsConfig] Module loaded. Tools found:', toolsConfig.getTools().length); 