export interface NodeInstance {
  _inputs: Record<string, { type: string }>;
  setInputValue: (name: string, value: any) => void;
  getInputValue: (name: string) => any;
  setVariant: (variant: any) => void;
}

export type TSFixme = any;
export interface NodeRegister {
  hasNode: (typename: string) => boolean;
  getNodeMetadata: (typename: string) => any;
}
export interface GraphModel {
  getMetaData: (key: string) => any;
  on: (event: string, callback: (data: any) => void) => void;
  getVariants: () => any[];
}
