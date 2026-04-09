/**
 * NODE SOURCE CODE DOCUMENTATION LOADER
 * AUTO-GENERATED - DO NOT EDIT
 * 
 * Generated: 2026-03-31T13:37:19.699Z
 * 
 * This file provides access to compiled XGENIA node source documentation
 * for AI tools to search and understand node behavior.
 */

import searchIndex from './search-index.json';
import metadata from './metadata.json';

export interface NodeDocumentation {
  name: string;
  file: string;
  relativePath: string;
  inputs: { code: string; startLine: number } | null;
  outputs: { code: string; startLine: number } | null;
  prototypeExtensions: { code: string; startLine: number } | null;
  helpers: Array<{ name: string; code: string }>;
  fullDefinition: string;
  category: string | null;
  docs: string | null;
  lineCount: number;
  byteSize: number;
}

export interface SearchIndex {
  nodes: Record<string, NodeDocumentation>;
  byCategory: Record<string, string[]>;
  portIndex: Record<string, Array<{ node: string; direction: 'input' | 'output' }>>;
}

// Available node types
export const AVAILABLE_NODES = ["Component Inputs","Component Outputs","Addition","Ceil","Division","Equal","Floor","ISAAC Random Number Array Generator","ISAAC Random Number Generator","Less Than","Less Than Or Equal","Max","Max Array","Formula-Generated Array","Min","Min Array","Modulo","Multiplication","Round","Single Parameter Formula","Subtraction","Sum","True Random Number Array Generator","True Random Number Generator","And ","Animation","arrayStateManager","Boolean To Signal","Boolean To String","Condition","Convert Dict Keys to Ports","Counter","Cloud File","DbCollection2","DbConfig","collectionName","AddDbModelRelation","RemoveDbModelRelation","DbModel2","DeleteDbModelProperties","FilterDBModels","conditionalports/extended","Model2","NewDbModelProperties","NewModel","REST2","SetDbModelProperties","SetModelProperties","Date To String","Expression","If","Import from JSON file","Inverter","Loop","MCP Tool","Or ","RunTasks","Relay","JavaScriptFunction","stateManager","String Format","String Mapper","Substring","Unique Id","net.xgenia.user.SetUserProperties","net.xgenia.user.User","Boolean","Number","String","Export to JSON file","@xgenia/pro-nodes","Auto ML Analyzer","Auto ML Predictor","Auto ML Trainer","Client Retention Analyzer","Retention Action Engine","pixi.AnimatedSprite","pixi.AssetPreloader","pixi.BitmapText","pixi.Camera2D","pixi.CollisionDetector","pixi.Container","pixi.Container","pixi.DebugInfo","pixi.GSAPInertia","pixi.GSAPPhysics","pixi.Graphics","pixi.HTMLText","pixi.MatterPhysics","pixi.MeshRope","pixi.NineSlicePlane","pixi.ParticleContainer","pixi.ParticleEmitter","pixi.ReelCell","pixi.ReelColumn","pixi.RenderTexture","pixi.RevoltFX","pixi.Spine","pixi.Sprite","pixi.Spritesheet","pixi.Stage","pixi.Text","pixi.TilingSprite","pixi.UIScaler","PixiReelController","Render Paylines Pixi","Calculate Free Spins States","Calculate Winnings","Cascade The Reels","Check Jackpot","Check Wins","Generate Reel Strips","Generate Symbol Weights","Get Paytable","Init Free Spins","Reel Strips Generator","Reel Ways Calculate Winnings","Reel Ways Check Wins","Render Paylines","SlotMainEngine","Slot Simulation","Slot Spin","Spin Calculate","Spin Result","Symbol Frequency Tracker","Volatility Estimator","Weighted Reels","stake.API_MULTIPLIER","stake.RGSAuthenticate","stake.BalanceUpdate","stake.RGSBalance","stake.DisplayAmount","stake.RGSEndRound","stake.RGSEvent","stake.ParseAmount","stake.RGSPlay","stake.RoundActive","stake.ToAPIAmount","enum","string","hyve.DataModelNode","hyve.FeatureNode","hyve.GoalNode","hyve.TaskNode","hyve.UINode","hyve.UserStoryNode","pixi.InputAction","NavigationClosePopup","PageStackNavigateBack","PageStackNavigateToPath","PageStackNavigate","PageInputs","Page","RouterNavigate","NavigationShowPopup","tr-direction","tr-direction","AdvancedTimer","logic.InputAction","net.xgenia.animatetovalue","net.xgenia.animationtarget","Animation","Color Blend","stringlist","net.xgenia.ComponentObject","net.xgenia.ParentComponentObject","net.xgenia.SetComponentObjectProperties","net.xgenia.SetParentComponentObjectProperties","Cloud Function","CloudFunction2","CollectionInsert","CollectionNew","CollectionRemove","Collection2","Concatenate Array","CopyArray","Extract Values","Fill-Generated Array","Filter Collection","For Each Actions","GetArrayItem","Iterator","Map Collection","Model2","ModifyObjectInArray","Set Variable","Show Value","Sort Collection","Static Data","Variable2","Event Receiver","Event Sender","net.xgenia.externallink","net.xgenia.gsapAnimator","Javascript2","Number Remapper","Open File Picker","Screen Resolution","States","Switch","Timer","Timestamp","Upload File","net.xgenia.user.LogIn","net.xgenia.user.LogOut","net.xgenia.user.RequestPasswordReset","net.xgenia.user.ResetPassword","net.xgenia.user.SendEmailVerification","net.xgenia.user.SignUp","net.xgenia.user.VerifyEmail","Value Changed","Color","Circle","net.xgenia.visual.columns","CSS Definition","Debug Panel Visual","Object Viewer","Distribution Chart","Drag","Group","Histogram Chart","net.xgenia.visual.icon","Image","Line Chart","xgenia.Loader","Project Version Tag","Reel Visualizer","Text","Video","xgenia.cloud.aggregate"];

// Load specific node documentation
export async function loadNodeDocs(nodeName: string): Promise<NodeDocumentation | null> {
  try {
    const safeName = nodeName.replace(/[\/\\]/g, '_');
    const doc = await import(`./nodes/${safeName}.json`);
    return doc.default || doc;
  } catch (error) {
    console.error(`Failed to load docs for ${nodeName}:`, error);
    return null;
  }
}

// Search capabilities
export function searchByPortName(portName: string): Array<{ node: string; direction: 'input' | 'output' }> {
  return (searchIndex as SearchIndex).portIndex[portName] || [];
}

export function getNodesByCategory(category: string): string[] {
  return (searchIndex as SearchIndex).byCategory[category] || [];
}

export function getAllCategories(): string[] {
  return Object.keys((searchIndex as SearchIndex).byCategory);
}

export function searchNodes(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  return AVAILABLE_NODES.filter(name => 
    name.toLowerCase().includes(lowerQuery)
  );
}

// Metadata
export const DOCUMENTATION_METADATA = metadata;

// Re-export search index for direct access
export { searchIndex };
