# XGENIA Visual Inspector Integration

## Overview

The XGENIA visual inspector allows you to hover over elements in the webview and see which XGENIA node they correspond to. This enables visual debugging and direct manipulation of UI components.

## Problem Solved

Previously, the inspector couldn't map DOM elements back to XGENIA nodes because components didn't have identifying information. The console would show:

```
[Inspector] Found xgeniaNode: none
```

## Solution

Components now need to register their DOM elements with node IDs using the `InspectorRegistration` utility.

## Usage

### Method 1: React Hook (Recommended)

```tsx
import React, { useRef } from 'react';
import { useInspectorRegistration } from '../shared/InspectorRegistration';

function MyButtonComponent({ nodeId, children, ...props }) {
  const ref = useInspectorRegistration(nodeId);

  return (
    <button ref={ref} {...props}>
      {children}
    </button>
  );
}
```

### Method 2: Manual Registration

```tsx
import React, { useEffect, useRef } from 'react';
import { InspectorRegistration } from '../shared/InspectorRegistration';

function MyComponent({ nodeId, children }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && nodeId) {
      InspectorRegistration.register(ref.current, nodeId);
    }
  }, [nodeId]);

  return <div ref={ref}>{children}</div>;
}
```

### Method 3: Higher-Order Component

```tsx
import React from 'react';
import { withInspectorRegistration } from '../shared/InspectorRegistration';

const MyComponent = ({ nodeId, children }) => (
  <div>{children}</div>
);

export default withInspectorRegistration(MyComponent);
```

## How It Works

1. **Registration**: Components call `InspectorRegistration.register(element, nodeId)` when they mount
2. **Data Attributes**: The system adds `data-xgenia-node-id="your-node-id"` to DOM elements
3. **Lookup**: The inspector finds the nearest element with this attribute when hovering
4. **Mapping**: DOM elements are mapped back to XGENIA nodes for selection and manipulation

## Inspector Features

- **Hover Detection**: Mouse movement over DOM elements
- **Node Highlighting**: Visual feedback showing which node is selected
- **Click Selection**: Click to select nodes in the editor
- **Automatic Cleanup**: Elements are unregistered when components unmount

## Browser Console Logs

When working correctly, you'll see:

```
[Inspector] ENABLE called - adding event listeners
[Inspector] Event listeners added successfully
[NodeRegistry] Registering element for node: your-node-id
[Inspector] Found node via NodeRegistry: your-node-id
[Inspector] Node selected: your-node-id
```

## Integration Points

- **Webview Preload Script**: `packages/xgenia-editor/src/assets/webview-preload-viewer.js`
- **CanvasView**: `packages/xgenia-editor/src/editor/src/views/VisualCanvas/CanvasView.ts`
- **Registration Utility**: `packages/xgenia-editor/src/shared/InspectorRegistration.tsx`

## Next Steps

To fully enable the inspector:

1. **Update Components**: Modify XGENIA components to use inspector registration
2. **Test Inspector**: Enable inspect mode and hover over elements
3. **Verify Logs**: Check console for successful node detection
4. **Handle Edge Cases**: Components that render multiple DOM elements may need special handling

## Troubleshooting

### Inspector shows "none"
- Component isn't registered with `InspectorRegistration`
- Node ID is undefined or invalid
- DOM element isn't properly attached to document

### Registration fails
- Check that `window.XgeniaNodeRegistry` exists
- Verify nodeId is a valid string
- Ensure element is attached to DOM before registration

### Multiple elements for one node
- Register the most interactive element (button, input, etc.)
- Use `querySelector` to find the best element for registration
