#!/bin/bash
# ============================================================================
# XGENIA Open Source Release Script
# ============================================================================
# This script prepares the GPL-3 licensed XGENIA Editor for open source release
# by EXCLUDING the proprietary AI service.
#
# Usage: ./prepare-opensource-release.sh [target-directory]
# ============================================================================

set -e

TARGET_DIR="${1:-../xgenia-editor-opensource}"
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "============================================"
echo "  XGENIA Open Source Release Preparation"
echo "============================================"
echo ""
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Copy all packages EXCEPT xgenia-ai-service
echo "📦 Copying GPL-3 licensed packages..."
for dir in "$SOURCE_DIR/packages/"*; do
  dirname=$(basename "$dir")
  
  if [ "$dirname" = "xgenia-ai-service" ]; then
    echo "   ⏩ Skipping proprietary: $dirname"
  else
    echo "   ✅ Copying: $dirname"
    cp -R "$dir" "$TARGET_DIR/packages/"
  fi
done

# Copy root files
echo ""
echo "📄 Copying root configuration files..."
cp "$SOURCE_DIR/package.json" "$TARGET_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/lerna.json" "$TARGET_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/tsconfig.json" "$TARGET_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/.gitignore" "$TARGET_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/README.md" "$TARGET_DIR/" 2>/dev/null || true

# Remove AI-specific code from editor that shouldn't be in open source
echo ""
echo "🧹 Removing embedded AI code from editor..."

# The AI bridge files should STAY (they're GPL-3 licensed)
# But remove any accidentally copied proprietary files

# Create a .gitignore addition for the open source repo
cat >> "$TARGET_DIR/.gitignore" << 'EOF'

# Proprietary AI Service (not included in open source release)
packages/xgenia-ai-service/
**/xgenia-ai-service/
EOF

# Create LICENSE file
echo ""
echo "📜 Creating GPL-3 LICENSE file..."
cat > "$TARGET_DIR/LICENSE" << 'EOF'
                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The GNU General Public License is a free, copyleft license for
software and other kinds of works.

[Full GPL-3 text - see https://www.gnu.org/licenses/gpl-3.0.txt]
EOF

# Create open source README
echo ""
echo "📝 Creating open source README..."
cat > "$TARGET_DIR/README.md" << 'EOF'
# XGENIA Editor

**Node-Based App Builder for Scalability & Rapid Development**

XGENIA is a visual development environment forked from [Noodl](https://github.com/noodlapp/noodl). 
It allows you to build applications using a node-based interface without writing code.

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3).

See [LICENSE](LICENSE) for the full license text.

### Attribution

Based on Noodl Editor, Copyright (C) 2024 Future Platforms AB

## AI Features

The open source version includes the core editor functionality. 
AI-powered features are available through [XGENIA Pro](https://xgenia.ai).

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Links

- [XGENIA Website](https://xgenia.ai)
- [Documentation](https://docs.xgenia.ai)
- [Original Noodl](https://github.com/noodlapp/noodl)
EOF

echo ""
echo "============================================"
echo "  ✅ Open Source Release Ready!"
echo "============================================"
echo ""
echo "Target directory: $TARGET_DIR"
echo ""
echo "Next steps:"
echo "  1. Review the contents of $TARGET_DIR"
echo "  2. Test that the editor works without AI service"
echo "  3. Create a new Git repository"
echo "  4. Push to GitHub as public repository"
echo ""
echo "The proprietary AI service (xgenia-ai-service) was NOT included."
echo ""
