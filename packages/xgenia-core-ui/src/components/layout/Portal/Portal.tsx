import { Slot } from '@xgenia-core-ui/types/global';
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ReactNode } from 'react';

interface PortalProps {
   children: ReactNode;
  portalRoot: Element;
}

export function Portal({ children, portalRoot }: PortalProps) {
  // Better fix: Use useRef to persist the element across renders
  const elementRef = useRef<HTMLDivElement | null>(null);
  
  // Create element only once if it doesn't exist
  if (!elementRef.current) {
    elementRef.current = document.createElement('div');
  }

  useEffect(() => {
    const element = elementRef.current!;
    portalRoot.appendChild(element);

    return () => {
      if (portalRoot.contains(element)) {
        portalRoot.removeChild(element);
      }
    };
  }, [portalRoot]); // Only depend on portalRoot

  // Use the stable element reference
  return createPortal(children, elementRef.current!);
}
