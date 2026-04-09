import * as React from 'react';
const { useEffect, useRef } = React;

/**
 * InspectorRegistration - Utility for XGENIA components to register their DOM elements
 *
 * This allows the visual inspector to map DOM elements back to XGENIA nodes.
 *
 * Usage in React components:
 * ```tsx
 * import { InspectorRegistration } from './InspectorRegistration';
 *
 * function MyComponent({ nodeId, ...props }) {
 *   const ref = useRef<HTMLDivElement>(null);
 *
 *   useEffect(() => {
 *     if (ref.current && nodeId) {
 *       InspectorRegistration.register(ref.current, nodeId);
 *     }
 *   }, [nodeId]);
 *
 *   return <div ref={ref} {...props} />;
 * }
 * ```
 */

export class InspectorRegistration {
  /**
   * Register a DOM element with its XGENIA node ID
   * This allows the inspector to find nodes when hovering over DOM elements
   */
  static register(element: HTMLElement, nodeId: string): void {
    if (!element || !nodeId) return;

    // Check if we're in a webview context with the NodeRegistry
    if (typeof window !== 'undefined' && window.XgeniaNodeRegistry) {
      try {
        window.XgeniaNodeRegistry.registerElement(element, nodeId);
        console.log(`[InspectorRegistration] Registered element for node: ${nodeId}`);
      } catch (e: any) {
        console.warn('[InspectorRegistration] Failed to register element:', e);
      }
    } else {
      // Fallback: add data attribute directly
      try {
        element.setAttribute('data-xgenia-node-id', nodeId);
        console.log(`[InspectorRegistration] Set data attribute for node: ${nodeId}`);
      } catch (e: any) {
        console.warn('[InspectorRegistration] Failed to set data attribute:', e);
      }
    }
  }

  /**
   * Auto-register common interactive elements by scanning the DOM
   * This is a fallback for components that don't manually register
   */
  static autoRegister(nodeId: string, container?: HTMLElement): void {
    if (!nodeId) return;

    const root = container || document.body;
    if (!root) return;

    // Find elements that might belong to this node
    const selectors = [
      `button[data-node-id="${nodeId}"]`,
      `input[data-node-id="${nodeId}"]`,
      `img[data-node-id="${nodeId}"]`,
      `div[data-node-id="${nodeId}"]`,
      `[data-testid="${nodeId}"]`,
      `#${nodeId}`,
      `.${nodeId}`
    ];

    for (const selector of selectors) {
      const elements = root.querySelectorAll(selector);
      elements.forEach(element => {
        if (element instanceof HTMLElement && !element.hasAttribute('data-xgenia-node-id')) {
          this.register(element, nodeId);
        }
      });
    }
  }

  /**
   * Unregister a DOM element
   */
  static unregister(element: HTMLElement): void {
    if (!element) return;

    if (typeof window !== 'undefined' && window.XgeniaNodeRegistry) {
      // The WeakMap will automatically clean up when the element is garbage collected
      // But we can remove the data attribute
      try {
        element.removeAttribute('data-xgenia-node-id');
      } catch (e: any) {
        // Ignore errors
      }
    }
  }

  /**
   * Get the node ID for a DOM element (if registered)
   */
  static getNodeId(element: HTMLElement): string | null {
    if (!element) return null;

    // Try NodeRegistry first
    if (typeof window !== 'undefined' && window.XgeniaNodeRegistry) {
      try {
        return window.XgeniaNodeRegistry.getNodeId(element);
      } catch (e: any) {
        // Fall through to data attribute
      }
    }

    // Try data attribute
    return element.getAttribute('data-xgenia-node-id');
  }
}

/**
 * React hook for automatic inspector registration
 * Automatically registers/unregisters DOM elements when they mount/unmount
 */
export function useInspectorRegistration(nodeId: string | undefined) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element && nodeId) {
      InspectorRegistration.register(element, nodeId);

      return () => {
        InspectorRegistration.unregister(element);
      };
    }
  }, [nodeId]);

  return ref;
}

/**
 * Higher-order component for inspector registration
 * Wraps a component to automatically register its root element
 */
export function withInspectorRegistration<P extends object>(
  Component: React.ComponentType<P & { nodeId?: string }>
) {
  const WrappedComponent = React.forwardRef<any, P & { nodeId?: string }>((props, ref) => {
    const inspectorRef = useInspectorRegistration(props.nodeId);

    // Use either the provided ref or the inspector ref
    const elementRef = ref || inspectorRef;

    return React.createElement(Component as any, { ...props, ref: elementRef });
  });

  // Set display name for better debugging
  WrappedComponent.displayName = `withInspectorRegistration(${Component.displayName || Component.name || 'Component'})`;

  return WrappedComponent;
}

// Type declarations for the global NodeRegistry
declare global {
  interface Window {
    XgeniaNodeRegistry?: {
      registerElement: (element: HTMLElement, nodeId: string) => void;
      getNodeId: (element: HTMLElement) => string | null;
    };
  }
}
