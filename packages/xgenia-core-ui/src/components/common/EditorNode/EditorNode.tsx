import classNames from 'classnames';
import React, { CSSProperties } from 'react';

import { INodeType, INodeColorScheme } from '@xgenia-types/nodeTypes';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';

import css from './EditorNode.module.scss';

export interface EditorNodeProps {
  item: INodeType;
  colors: INodeColorScheme;
  isHighlighted?: boolean;
}

function nodeNameToIconName(itemName: INodeType['name']) {
  switch (itemName) {
    // Visual/UI nodes
    case 'Group':
      return IconName.Group;
    case 'Text':
      return IconName.TextInBox;
    case 'Image':
      return IconName.Image;
    case 'Video':
      return IconName.Video;
    case 'Circle':
      return IconName.CircleOpen;
    case 'net.xgenia.visual.icon':
      return IconName.Icon;
    case 'net.xgenia.visual.columns':
      return IconName.Columns;
    case 'Sound':
      return IconName.PlayCircle;

    // Control/UI nodes
    case 'net.xgenia.controls.button':
      return IconName.Button;
    case 'net.xgenia.controls.checkbox':
      return IconName.CheckboxFilled;
    case 'net.xgenia.controls.options':
      return IconName.DropdownLines;
    case 'net.xgenia.controls.radiobutton':
      return IconName.Radiobutton;
    case 'Radio Button Group':
      return IconName.RadiobuttonGroup;
    case 'net.xgenia.controls.range':
      return IconName.SlidersFilled;
    case 'net.xgenia.controls.textinput':
      return IconName.TextInput;

    // Animation
    case 'net.xgenia.animationtarget':
    case 'Animation':
      return IconName.MagicWand;

    // Math operations
    case 'Addition':
    case 'Subtraction':
    case 'Multiplication':
    case 'Division':
    case 'Modulo':
    case 'Round':
    case 'Ceil':
    case 'Floor':
    case 'Single Parameter Formula':
      return IconName.StructureCircle;
    case 'Equal':
    case 'Less Than':
    case 'Less Than Or Equal':
      return IconName.Check;
    case 'Max':
    case 'Max Array':
    case 'Min':
    case 'Min Array':
    case 'Sum':
      return IconName.ArrowUp;

    // Random/Generator nodes
    case 'ISAAC Random Number Generator':
    case 'ISAAC Random Number Array Generator':
    case 'True Random Number Generator':
    case 'True Random Number Array Generator':
    case 'Formula-Generated Array':
    case 'Unique Id':
      return IconName.Roll;

    // Logic nodes
    case 'And ':
    case 'Or ':
    case 'Not':
    case 'Condition':
    case 'If':
      return IconName.Code;
    case 'Switch':
      return IconName.ArrowRight;
    case 'Boolean To Signal':
    case 'Boolean To String':
      return IconName.Check;
    case 'Inverter':
      return IconName.Refresh;
    case 'Counter':
      return IconName.Plus;

    // Data/Storage nodes
    case 'Variable':
    case 'Number':
    case 'String':
    case 'Boolean':
    case 'stateManager':
    case 'arrayStateManager':
      return IconName.Stash;
    case 'Object':
    case 'Array':
      return IconName.StructureCircle;
    case 'Cloud File':
    case 'Import from JSON file':
    case 'Export to JSON file':
      return IconName.File;
    case 'DbCollection2':
    case 'DbConfig':
    case 'collectionName':
    case 'DbModel2':
    case 'Model2':
    case 'NewModel':
      return IconName.CloudData;
    case 'REST2':
      return IconName.RestApi;
    case 'AddDbModelRelation':
    case 'RemoveDbModelRelation':
    case 'SetDbModelProperties':
    case 'SetModelProperties':
    case 'NewDbModelProperties':
    case 'DeleteDbModelProperties':
      return IconName.Pencil;
    case 'FilterDBModels':
      return IconName.Search;

    // Component inputs/outputs
    case 'Component Inputs':
    case 'Component Outputs':
      return IconName.Component;

    // Utility nodes
    case 'Expression':
    case 'JavaScriptFunction':
      return IconName.Code;
    case 'String Format':
    case 'String Mapper':
    case 'Substring':
      return IconName.TextInBox;
    case 'Date To String':
      return IconName.TextInBox;
    case 'Loop':
      return IconName.Refresh;
    case 'MCP Tool':
      return IconName.Setting;
    case 'RunTasks':
      return IconName.Play;
    case 'Relay':
      return IconName.ArrowRight;
    case 'Convert Dict Keys to Ports':
      return IconName.Component;

    // User/Auth nodes
    case 'net.xgenia.user.SetUserProperties':
    case 'net.xgenia.user.User':
      return IconName.User;

    // Slot game nodes
    case 'Auto ML Analyzer':
    case 'Auto ML Predictor':
    case 'Auto ML Trainer':
      return IconName.StructureCircle;
    case 'Client Retention Analyzer':
    case 'Retention Action Engine':
      return IconName.User;
    case 'Calculate Free Spins States':
    case 'Calculate Winnings':
    case 'Check Jackpot':
    case 'Check Wins':
    case 'Spin Calculate':
    case 'Spin Result':
      return IconName.Roll;
    case 'Cascade The Reels':
    case 'Generate Reel Strips':
    case 'Get Paytable':
    case 'Reel Strips Generator':
    case 'Reel Ways Calculate Winnings':
    case 'Reel Ways Check Wins':
    case 'SlotMainEngine':
    case 'Slot Simulation':
    case 'Slot Spin':
    case 'Weighted Reels':
      return IconName.PlayCircle;
    case 'Generate Symbol Weights':
    case 'Symbol Frequency Tracker':
    case 'Volatility Estimator':
      return IconName.StructureCircle;
    case 'Init Free Spins':
      return IconName.Plus;

    default:
      return null;
  }
}

function fallbackIconByCategory(category?: string): IconName {
  if (!category) return IconName.CircleOpen; // Default fallback
  const c = category.toLowerCase();
  if (/(ui|visual|component|view)/.test(c)) return IconName.Components;
  if (/(data|cloud|store|db|variable|model)/.test(c)) return IconName.CloudData;
  if (/(logic|util|utility|compute|flow|expression)/.test(c)) return IconName.Code;
  if (/(anim|motion|transition)/.test(c)) return IconName.Play;
  if (/(input|form|control)/.test(c)) return IconName.TextInput;
  if (/(network|api|http|rest|graphql)/.test(c)) return IconName.RestApi;
  if (/(math|number|calc|random|generator)/.test(c)) return IconName.StructureCircle;
  if (/(event|signal)/.test(c)) return IconName.PlayCircle;
  if (/(string|text|format)/.test(c)) return IconName.TextInBox;
  if (/(game|slot|casino)/.test(c)) return IconName.Roll;
  if (/(user|auth|account)/.test(c)) return IconName.User;
  if (/(file|import|export)/.test(c)) return IconName.File;
  return IconName.CircleOpen; // Ultimate fallback
}

function getCategoryColor(category?: string): string {
  if (!category) return '#8B9AAF';
  const c = category.toLowerCase();
  if (/(ui|visual|component|view)/.test(c)) return '#EC5BE0'; // Pink
  if (/(data|cloud|store|db|variable|model)/.test(c)) return '#5B9AEC'; // Blue
  if (/(logic|util|utility|compute|flow|expression)/.test(c)) return '#67DE92'; // Green
  if (/(anim|motion|transition)/.test(c)) return '#FFB547'; // Orange
  if (/(navigation)/.test(c)) return '#9B59EC'; // Purple
  if (/(math|number|calc|random|generator)/.test(c)) return '#67DE92'; // Green
  if (/(event|signal)/.test(c)) return '#FFB547'; // Orange
  if (/(string|text|format)/.test(c)) return '#5B9AEC'; // Blue
  if (/(game|slot|casino)/.test(c)) return '#FF6B6B'; // Red
  if (/(user|auth|account)/.test(c)) return '#4ECDC4'; // Teal
  if (/(file|import|export)/.test(c)) return '#45B7D1'; // Light Blue
  return '#8B9AAF'; // Gray fallback
}

export function EditorNode({ item, colors, isHighlighted }: EditorNodeProps) {
  const explicitIcon = nodeNameToIconName(item.name);
  const fallbackIcon = fallbackIconByCategory((item as any)?.category);
  const iconName = explicitIcon || fallbackIcon;
  const categoryColor = getCategoryColor((item as any)?.category);

  return (
    <div
      className={classNames([css['Root'], isHighlighted && css['is-highlighted']])}
      style={
        {
          '--node-color': categoryColor,
          '--textColor': colors.text,
          '--baseColor': colors.headerHighlighted,
          '--highlightColor': colors.baseHighlighted
        } as CSSProperties
      }
    >
      {iconName && (
        <div className={css['IconWrapper']}>
          <Icon icon={iconName} size={IconSize.Tiny} />
        </div>
      )}
      <span className={css['Label']}>
        {item.displayName || item.displayNodeName || item.name}
      </span>
    </div>
  );
}
