import FontLoader from './fontloader';
import type { GraphModel, NodeRegister, TSFixme } from './typings/global';

// Weightless loadGoogleFont fetches only weight 400, so every bold render was
// faux-bold. Request the full useful range up front.
const DEFAULT_GOOGLE_FONT_WEIGHTS = '400,500,600,700,800,900';

// Define NodeInstance interface to fix TypeScript errors
interface NodeInstance {
  _inputs: Record<string, { type: string }>;
  getInputValue: (inputName: string) => any;
  setInputValue: (inputName: string, value: any) => void;
  setVariant: (variant: any) => void;
}

interface InputInfo {
  node: NodeInstance;
  inputs: string[];
}

function getInputsWithType(nodeScope: any, inputType: string): InputInfo[] {
  const result: InputInfo[] = [];

  const nodes: NodeInstance[] = nodeScope.getAllNodesRecursive();
  nodes.forEach((node: NodeInstance) => {
    const inputs: string[] = [];

    for (const inputName in node._inputs) {
      const input = node._inputs[inputName];
      if (input.type === inputType) {
        inputs.push(inputName);
      }
    }

    if (inputs.length) {
      result.push({ node, inputs });
    }
  });

  return result;
}

type TextStyleData = {
  letterSpacing: string;
  lineHeight: { value: string; unit: string };
  textTransform: string;
  fontSize: { value: string; unit: string };
  fontFamily?: string;
  color?: string;
};

type StylesData = {
  text?: Record<string, TextStyleData>;
  colors?: Record<string, string>;
};

export default class Styles {
  getNodeScope: () => TSFixme;
  graphModel: GraphModel;
  nodeRegister: NodeRegister;
  styles: StylesData = {};

  constructor({ graphModel, nodeRegister, getNodeScope }) {
    this.getNodeScope = getNodeScope;
    this.graphModel = graphModel;
    this.nodeRegister = nodeRegister;

    this.setStyles(graphModel.getMetaData('styles') || {});
    graphModel.on('metadataChanged.styles', (styles) => this.setStyles(styles));
  }

  setStyles(styles: StylesData) {
    // Brute force update all styles, no delta check
    this.styles = styles;

    // Process text styles
    const textStyles = styles.text || {};

    // Format font family
    Object.values(textStyles)
      .filter((style) => style.fontFamily)
      .forEach((textStyle) => {
        let family = textStyle.fontFamily;

        // Load files and create font css
        if (family && family.split('.').length > 1) {
          if (family) {
            // Use type assertion for FontLoader.instance
            (FontLoader as any).instance.loadFont(family);
            let fontFamily = family.replace(/\.[^/.]+$/, '');
            fontFamily = fontFamily.split('/').pop() || '';

            // Update the style to the font css instead of the file name
            if (typeof fontFamily === 'string') {
              textStyle.fontFamily = fontFamily as string;
            }
          }
        } else if (family && !(FontLoader as any).instance.loadedFontFamilies[family]) {
          // Non-file font that isn't already loaded — try as Google Font
          (FontLoader as any).instance.loadGoogleFont(family, DEFAULT_GOOGLE_FONT_WEIGHTS);
        }
      });

    // Format values with units (to css strings)
    for (const name in textStyles) {
      const style = textStyles[name];
      for (const prop in style) {
        const value = style[prop];
        if (typeof value === 'object' && value.value && value.unit) {
          style[prop] = value.value + value.unit;
        }
      }
    }

    // Remove colors with empty strings
    for (const name in textStyles) {
      const style = textStyles[name];
      if (style.color === '') {
        delete style.color;
      }
    }

    const nodeScope = this.getNodeScope && this.getNodeScope();
    if (!nodeScope) return;

    const variants = this.graphModel.getVariants();
    for (const variant of variants) {
      if (this._variantHasInputsWithTypes(variant, ['color', 'textStyle'])) {
        const nodes = nodeScope.getAllNodesWithVariantRecursive(variant);
        nodes.forEach((node: NodeInstance) => node.setVariant(variant));
      }
    }

    //set all inputs with types using styles
    //just re-apply the previous value to trigger a new style resolve
    ['color', 'textStyle'].forEach((inputType) => {
      getInputsWithType(nodeScope, inputType).forEach(({ node, inputs }) => {
        inputs.forEach((inputName) => {
          const inputValue = (node as NodeInstance).getInputValue(inputName);
          if (inputValue) {
            (node as NodeInstance).setInputValue(inputName, inputValue);
          }
        });
      });
    });
  }

  resolveColor(color: string) {
    if (!this.styles.colors) return color;

    const resolvedColor = this.styles.colors[color];
    return resolvedColor ? resolvedColor : color;
  }

  getTextStyle(styleName: string) {
    if (!this.styles.text) return {};
    return this.styles.text[styleName] || {};
  }

  //checks if a variant includes inputs with the specified types
  _variantHasInputsWithTypes(variant, types) {
    if (!this.nodeRegister.hasNode(variant.typename)) return;

    //get the metadata for the node this variant is used by
    const metadata = this.nodeRegister.getNodeMetadata(variant.typename);

    //get all the inputs this variant affects...
    const parameterNames = new Set(Object.keys(variant.parameters));
    for (const state in variant.stateParameters) {
      Object.keys(variant.stateParameters[state]).forEach((param) => parameterNames.add(param));
    }

    //...and check if the inputs are of the supplied types
    for (const param of Array.from(parameterNames)) {
      const inputType = metadata.inputs[param] && metadata.inputs[param].type;
      if (types.includes(inputType)) {
        return true;
      }
    }

    return false;
  }
}
