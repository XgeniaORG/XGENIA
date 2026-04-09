import { useModel } from '@xgenia-hooks/useModel';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { ReactNode } from 'react';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { StylesModel } from '@xgenia-models/StylesModel';

import { Slot } from '@xgenia-core-ui/types/global';

import { DesignTokenColor, extractProjectColors } from './extractProjectColors';

export interface ProjectDesignTokenContext {
  staticColors: DesignTokenColor[];
  dynamicColors: DesignTokenColor[];
  textStyles: TSFixme[];
}

const ProjectDesignTokenContext = createContext<ProjectDesignTokenContext>({
  staticColors: [],
  dynamicColors: [],
  textStyles: []
});

export interface ProjectDesignTokenContextProps {
   children: ReactNode;
}

export function ProjectDesignTokenContextProvider({ children }: ProjectDesignTokenContextProps) {
  useModel(ProjectModel.instance);
  const [group] = useState({});

  const [staticColors, setStaticColors] = useState<DesignTokenColor[]>([]);
  const [dynamicColors, setDynamicColors] = useState<DesignTokenColor[]>([]);
  const [textStyles, setTextStyles] = useState<TSFixme[]>([]);

  useEffect(() => {
    const stylesModel = new StylesModel();

    function extract() {
      const styles = stylesModel.getStyles('colors');
      const colors = extractProjectColors(ProjectModel.instance, styles);
      const textStyles = stylesModel.getStyles('text');

      setStaticColors(colors.staticColors);
      setDynamicColors(colors.dynamicColors);
      setTextStyles(textStyles);
    }

    stylesModel.on('stylesChanged', (args) => {
      if (['colors', 'text'].includes(args.type)) {
        extract();
      }
    });

    extract();

    return () => {
      stylesModel.dispose();
      if (ProjectModel.instance) {
        ProjectModel.instance.off(group);
      }
    };
  }, []);

  return (
    <ProjectDesignTokenContext.Provider
      value={{
        staticColors,
        dynamicColors,
        textStyles
      }}
    >
      {children}
    </ProjectDesignTokenContext.Provider>
  );
}

export function useProjectDesignTokenContext() {
  const context = useContext(ProjectDesignTokenContext);

  if (context === undefined) {
    throw new Error('useProjectDesignTokenContext must be a child of ProjectDesignTokenContextProvider');
  }

  return context;
}
