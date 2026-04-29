import { createContext, Dispatch, SetStateAction } from 'react';

export interface SidebarWidthContextValue {
  width: number | undefined;
  setWidth: Dispatch<SetStateAction<number | undefined>>;
}

export const SidebarWidthContext = createContext<SidebarWidthContextValue | null>(null);

