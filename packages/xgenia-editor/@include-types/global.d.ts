declare module '@hugeicons/react' {
  import React from 'react';
  export interface HugeiconsIconProps {
    icon: any;
    size?: number;
    color?: string;
    strokeWidth?: number;
    className?: string;
    style?: React.CSSProperties;
    [key: string]: any;
  }
  export const HugeiconsIcon: React.FC<HugeiconsIconProps>;
}

declare module '@hugeicons/core-free-icons' {
  const PlusSignIcon: any;
  const Setting06Icon: any;
  const Task01Icon: any;
  const StopIcon: any;
  const AttachmentIcon: any;
  const FolderOpenIcon: any;
  const Camera01Icon: any;
  const SentIcon: any;
  const Loading03Icon: any;
  const GlobeIcon: any;
  const Wrench01Icon: any;
  const Search01Icon: any;
  const IdeaIcon: any;
  const ChartIcon: any;
  const BrainIcon: any;
  const ViewIcon: any;
  const CheckmarkCircle01Icon: any;
  const CommentIcon: any;
  const Target01Icon: any;
  const NoteEditIcon: any;
  const FlashIcon: any;
  const SparklesIcon: any;
  const AlertCircleIcon: any;
  const Copy01Icon: any;
  const ArrowUp01Icon: any;
  const RobotIcon: any;
  const RefreshIcon: any;
  const Key01Icon: any;
  const PuzzleIcon: any;
  const FavouriteIcon: any;
  const AiSettingIcon: any;
  const Clock01Icon: any;
  export {
    PlusSignIcon, Setting06Icon, Task01Icon, StopIcon,
    AttachmentIcon, FolderOpenIcon, Camera01Icon, SentIcon, Loading03Icon,
    GlobeIcon, Wrench01Icon, Search01Icon, IdeaIcon, ChartIcon,
    BrainIcon, ViewIcon, CheckmarkCircle01Icon, CommentIcon,
    Target01Icon, NoteEditIcon, FlashIcon, SparklesIcon, AlertCircleIcon,
    Copy01Icon, ArrowUp01Icon, RobotIcon, RefreshIcon, Key01Icon,
    PuzzleIcon, FavouriteIcon, AiSettingIcon, Clock01Icon
  };
}

declare module '*.svg' {
  import React = require('react');
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}

declare module '*.css' {
  const styles: { readonly [key: string]: string };
  export default styles;
}

declare module '*.scss' {
  const styles: { readonly [key: string]: string };
  export default styles;
}

declare module '*.html' {
  const content: string;
  export default content;
}

type TSFixme = any;

type NodeColor = 'data' | 'visual' | 'logic' | 'component' | 'javascript';

interface Window {
  xgeniaEditorPreviewRoute: string;
  EventDispatcher?: {
    instance: {
      emit: (event: string, data: any) => void;
    };
  };
  mcpAPI: {
    loadAllMcpServers: () => Promise<MCPServer[]>;
    addOrUpdateMcpServer: (server: MCPServer) => Promise<MCPServer>;
    removeMcpServer: (serverName: string) => Promise<boolean>;
    fetchTools: (serverName: string) => Promise<MCPTool[]>;
    callTool: (serverName: string, toolName: string, inputSchema: any) => Promise<any>;
    // Initialization helpers
    isInitialized: () => boolean;
    onInitialized: (callback: () => void) => void;
    // OAuth authentication methods
    startOAuthServer: () => Promise<{ port: number; callbackUrl: string }>;
    setOAuthRedirectUri: (uri: string) => void;
    registerOAuthClient: (serverName: string) => Promise<{ clientId: string; clientSecret?: string }>;
    initiateOAuthFlow: (serverName: string) => Promise<{ authUrl: string; state: string }>;
    handleOAuthCallback: (
      serverName: string,
      code: string,
      state: string,
      expectedState: string
    ) => Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
    refreshOAuthToken: (serverName: string) => Promise<string>;
    isTokenExpired: (serverName: string) => Promise<boolean>;
    // Events
    onServersChanged: (callback: () => void) => void | (() => void);
  };
}

type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types
} & {};

type PartialWithRequired<T, K extends keyof T> = Pick<T, K> & Partial<T>;

interface ImportMeta {
  webpackHot: {
    accept(path?: string, callback?: () => void): void;
    dispose(callback: (data: any) => void): void;
    data: any;
  };
}
