import path from 'path';
import fs from 'fs';
import Model from '../../../shared/model';
import { ProjectModel } from './projectmodel';

export interface ToolMetadata {
  id: string;
  name: string;
  description?: string;
  category?: string;
  componentName: string; // The XGENIA component name
  icon?: string;
}

export interface ToolsProjectInfo {
  path: string;
  components: ToolMetadata[];
}

export enum ToolsModelEvent {
  ToolsLoaded = 'toolsLoaded',
  ToolsProjectPathChanged = 'toolsProjectPathChanged',
  Error = 'error'
}

export class ToolsModel extends Model {
  public static instance = new ToolsModel();

  private _toolsProjectPath: string | null = null;
  private _toolsProjectInfo: ToolsProjectInfo | null = null;
  private _tools: ToolMetadata[] = [];
  private _categories: string[] = [];

  constructor() {
    super();
    console.log(`[ToolsModel] Constructor: Attempting initial loadToolsProjectPath. Timestamp: ${new Date().toISOString()}`);
    this.loadToolsProjectPath();
  }

  public get toolsProjectPath(): string | null {
    return this._toolsProjectPath;
  }

  public get tools(): readonly ToolMetadata[] {
    return this._tools;
  }

  public get categories(): readonly string[] {
    return this._categories;
  }

  public get toolsProjectInfo(): ToolsProjectInfo | null {
    return this._toolsProjectInfo;
  }

  public setToolsProjectPath(projectPath: string | null): void {
    if (this._toolsProjectPath === projectPath) return;
    
    this._toolsProjectPath = projectPath;
    this.saveToolsProjectPath();
    this.notifyListeners(ToolsModelEvent.ToolsProjectPathChanged);
    
    if (projectPath) {
      this.scanToolsProject();
    } else {
      this._toolsProjectInfo = null;
      this._tools = [];
      this._categories = [];
      this.notifyListeners(ToolsModelEvent.ToolsLoaded, this._tools);
    }
  }

  public async scanToolsProject(): Promise<void> {
    console.log('[ToolsModel] scanToolsProject: Called.');
    this.loadToolsProjectPath();
    console.log(`[ToolsModel] scanToolsProject: Current _toolsProjectPath is '${this._toolsProjectPath}' after load attempt.`);

    try {
      if (!this._toolsProjectPath) {
        console.warn('[ToolsModel] scanToolsProject: Bailing out, _toolsProjectPath is still null or empty.');
        this._tools = [];
        this._categories = [];
        this.notifyListeners(ToolsModelEvent.Error, 'No tools project path configured after load attempt');
        return;
      }

      const projectJsonPath = path.join(this._toolsProjectPath, 'project.json');
      
      if (!fs.existsSync(projectJsonPath)) {
        console.warn(`[ToolsModel] scanToolsProject: project.json not found at: ${projectJsonPath}`);
        this._tools = [];
        this._categories = [];
        this.notifyListeners(ToolsModelEvent.Error, 'Tools project file (project.json) not found');
        return;
      }

      console.log('[ToolsModel] scanToolsProject: Reading tools project from:', projectJsonPath);
      const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      
      if (!projectData.components || !Array.isArray(projectData.components)) {
        console.warn('[ToolsModel] scanToolsProject: No components array found in tools project.json');
        this._tools = [];
        this._categories = [];
        this.notifyListeners(ToolsModelEvent.ToolsLoaded, this._tools);
        return;
      }

      console.log(`[ToolsModel] scanToolsProject: Found ${projectData.components.length} components in project.json`);

      const discoveredTools: ToolMetadata[] = [];
      const categories = new Set<string>();

      for (const component of projectData.components) {
        const componentName = component.name;
        console.log(`[ToolsModel] scanToolsProject: Processing component: "${componentName}"`);
        
        if (componentName === '/App' || componentName === '/Start Page') {
          console.log(`[ToolsModel] scanToolsProject: Skipping system component: "${componentName}"`);
          continue;
        }

        const startsWithTool = componentName.startsWith('/Tool_');
        const isAcceptable = this.isAcceptableToolComponent(componentName);
        const isToolComponent = startsWithTool || isAcceptable;

        console.log(`[ToolsModel] scanToolsProject: Component "${componentName}" - startsWithTool: ${startsWithTool}, isAcceptable: ${isAcceptable}, isToolComponent: ${isToolComponent}`);

        if (isToolComponent) {
          const toolMetadata = this.extractToolMetadata(component);
          if (toolMetadata) {
            console.log(`[ToolsModel] scanToolsProject: Successfully created tool metadata for "${componentName}": ${JSON.stringify(toolMetadata)}`);
            discoveredTools.push(toolMetadata);
            if (toolMetadata.category) {
              categories.add(toolMetadata.category);
            }
          } else {
            console.warn(`[ToolsModel] scanToolsProject: Failed to extract tool metadata for "${componentName}"`);
          }
        } else {
          console.log(`[ToolsModel] scanToolsProject: Component "${componentName}" not recognized as a tool`);
        }
      }

      this._tools = discoveredTools;
      this._categories = Array.from(categories);
      
      console.log(`[ToolsModel] scanToolsProject: Discovered ${this._tools.length} tools. Emitting ToolsLoaded.`, 
                  this._tools.map(t => t.name));
      
      this.notifyListeners(ToolsModelEvent.ToolsLoaded, this._tools);

    } catch (error: any) {
      console.error('[ToolsModel] scanToolsProject: Error during scanning:', error);
      this._tools = [];
      this._categories = [];
      this.notifyListeners(ToolsModelEvent.Error, error.message);
    }
  }

  private isAcceptableToolComponent(componentName: string): boolean {
    const acceptablePatterns = [
      '/Create Image',
      '/Create Image2', 
      '/Calculate',
    ];
    const toolKeywords = ['create', 'generate', 'edit', 'convert', 'process', 'tool'];
    const lowerName = componentName.toLowerCase();
    
    const matchesPattern = acceptablePatterns.includes(componentName);
    const matchesKeyword = toolKeywords.some(keyword => lowerName.includes(keyword));
    const result = matchesPattern || matchesKeyword;
    
    console.log(`[ToolsModel] isAcceptableToolComponent: "${componentName}" (lowercase: "${lowerName}") - matchesPattern: ${matchesPattern}, matchesKeyword: ${matchesKeyword}, result: ${result}`);
    if (matchesKeyword) {
      const matchingKeywords = toolKeywords.filter(keyword => lowerName.includes(keyword));
      console.log(`[ToolsModel] isAcceptableToolComponent: Matching keywords: ${matchingKeywords.join(', ')}`);
    }
    
    return result;
  }

  private extractToolMetadata(component: any): ToolMetadata | null {
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
    return { id: toolId, name: friendlyName, description, category, componentName: component.name, icon };
  }

  private loadToolsProjectPath(): void {
    console.log('[ToolsModel] loadToolsProjectPath: Attempting to determine tools project path.');
    let foundPath: string | null = null;

    // 1. Check Project Settings (user override)
    const projectSettings = ProjectModel.instance?.getSettings();
    if (projectSettings?.toolsProjectPath) {
      let resolvedPathFromSettings = projectSettings.toolsProjectPath;
      if (!path.isAbsolute(resolvedPathFromSettings)) {
        if (ProjectModel.instance?._retainedProjectDirectory) {
          resolvedPathFromSettings = path.resolve(ProjectModel.instance._retainedProjectDirectory, resolvedPathFromSettings);
        } else {
          console.warn('[ToolsModel] loadToolsProjectPath: toolsProjectPath in settings is relative, but no current project directory to resolve against.');
          resolvedPathFromSettings = ''; // Invalidate
        }
      }

      if (resolvedPathFromSettings && fs.existsSync(path.join(resolvedPathFromSettings, 'project.json'))) {
        foundPath = resolvedPathFromSettings;
        console.log('[ToolsModel] loadToolsProjectPath: Path found and validated from project settings:', foundPath);
      } else if (projectSettings.toolsProjectPath) { // Log if a path was set but invalid
          console.warn('[ToolsModel] loadToolsProjectPath: toolsProjectPath from settings either could not be resolved or project.json not found at:', resolvedPathFromSettings || projectSettings.toolsProjectPath);
      }
    }

    this._toolsProjectPath = foundPath;

    if (this._toolsProjectPath) {
      console.log('[ToolsModel] loadToolsProjectPath: Final tools project path set to:', this._toolsProjectPath);
    } else {
      console.warn('[ToolsModel] loadToolsProjectPath: Could not determine tools project path through any method. _toolsProjectPath remains null.');
    }
  }

  private saveToolsProjectPath(): void {
    if (ProjectModel.instance) {
      ProjectModel.instance.setSetting('toolsProjectPath', this._toolsProjectPath);
    }
  }

  public getToolsByCategory(): Record<string, ToolMetadata[]> {
    const result: Record<string, ToolMetadata[]> = {};
    for (const tool of this._tools) {
      const category = tool.category || 'General';
      if (!result[category]) result[category] = [];
      result[category].push(tool);
    }
    return result;
  }

  public findToolById(id: string): ToolMetadata | undefined {
    return this._tools.find(tool => tool.id === id);
  }

  public findToolsByName(searchTerm: string): ToolMetadata[] {
    const term = searchTerm.toLowerCase();
    return this._tools.filter(tool => 
      tool.name.toLowerCase().includes(term) ||
      (tool.description && tool.description.toLowerCase().includes(term)) ||
      tool.category?.toLowerCase().includes(term)
    );
  }
} 