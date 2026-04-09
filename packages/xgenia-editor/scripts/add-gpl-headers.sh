#!/bin/bash

# Add GPL-3 license headers to files that remain in the editor
# These are files that are derived from Noodl (GPL-3) or are bridge files

GPL_HEADER="/**
 * XGENIA Editor - GPL-3 Licensed
 * 
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Based on Noodl Editor, Copyright (C) 2024 Future Platforms AB
 * Modifications Copyright (C) 2024-2026 XGENIA
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
"

# Files to add GPL header to (bridge files and GPL-specific files)
FILES=(
  "/Users/markfm/Documents/GitHub/XGENIA/packages/xgenia-editor/src/editor/src/views/panels/ChatPanel/AIBridgeProxy.ts"
  "/Users/markfm/Documents/GitHub/XGENIA/packages/xgenia-editor/src/editor/src/views/panels/ChatPanel/AIServiceClient.ts"
  "/Users/markfm/Documents/GitHub/XGENIA/packages/xgenia-editor/src/editor/src/views/panels/ChatPanel/InteractiveAgenticsSystemBridge.ts"
  "/Users/markfm/Documents/GitHub/XGENIA/packages/xgenia-editor/src/editor/src/views/panels/ChatPanel/api-contract.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    # Check if file already has GPL header
    if ! grep -q "GPL-3.0-or-later" "$file" 2>/dev/null; then
      # Check if file has existing header
      if head -1 "$file" | grep -q "^/\*\*"; then
        # File has header, update it
        TEMP_FILE=$(mktemp)
        awk '
          BEGIN { in_header=0; header_done=0 }
          /^\/\*\*/ && !header_done { in_header=1; next }
          /\*\// && in_header { in_header=0; header_done=1; next }
          in_header { next }
          { print }
        ' "$file" > "$TEMP_FILE"
        
        echo "$GPL_HEADER" | cat - "$TEMP_FILE" > "$file"
        rm "$TEMP_FILE"
        echo "Updated GPL header: $file"
      else
        # No header, prepend
        TEMP_FILE=$(mktemp)
        echo "$GPL_HEADER" | cat - "$file" > "$TEMP_FILE"
        mv "$TEMP_FILE" "$file"
        echo "Added GPL header: $file"
      fi
    else
      echo "Already has GPL header: $file"
    fi
  else
    echo "File not found: $file"
  fi
done

echo ""
echo "GPL header update complete!"
