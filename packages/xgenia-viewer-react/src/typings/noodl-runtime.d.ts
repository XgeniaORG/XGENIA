declare module '@xgenia/runtime' {
  interface XgeniaRuntimeInstance {
    graphModel: {
      routerIndex: {
        routers: any[];
        pages: any[];
      };
      getMetaData: (key: string) => any;
      on: (event: string, callback: (data: any) => void) => void;
      getVariants: () => any[];
    };
    getProjectSettings: () => any;
    SEO?: {
      setTitle: (_title: string) => void;
      setMeta: (_key: string, _value: string | undefined) => void;
    };
    Env?: Record<string, any>;
  }

  const XgeniaRuntime: {
    instance: XgeniaRuntimeInstance;
  };

  export default XgeniaRuntime;
}
