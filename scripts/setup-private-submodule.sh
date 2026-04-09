#!/bin/bash

# Configuration
PRIVATE_REPO_NAME="XGENIA-private"
PRIVATE_DIR="private"

echo "========================================="
echo "  XGENIA Private Repo Setup Assistant"
echo "========================================="
echo ""
echo "This script will help you link your local private code"
echo "to a new private GitHub repository."
echo ""

# Check if private dir is a git repo
if [ ! -d "$PRIVATE_DIR/.git" ]; then
    echo "❌ Error: $PRIVATE_DIR does not seem to be a git repository."
    echo "Run 'git init' inside $PRIVATE_DIR first."
    exit 1
fi

echo "Step 1: Create the repository on GitHub"
echo "---------------------------------------"
echo "1. Go to https://github.com/new"
echo "2. Repository name: $PRIVATE_REPO_NAME"
echo "3. Visibility: PRIVATE (Important!)"
echo "4. Do NOT initialize with README/gitignore"
echo "5. Click 'Create repository'"
echo ""
read -p "Press Enter when you have created the repository..."

echo ""
echo "Step 2: Enter the new repository URL"
echo "------------------------------------"
read -p "Paste the SSH URL (git@github.com:...) here: " REPO_URL

if [ -z "$REPO_URL" ]; then
    echo "❌ Error: URL cannot be empty."
    exit 1
fi

echo ""
echo "Step 3: Pushing code to $REPO_URL..."
echo "------------------------------------"

cd "$PRIVATE_DIR"
git remote add origin "$REPO_URL"
git branch -M main
git push -u origin main

if [ $? -ne 0 ]; then
    echo "❌ Error pushing to remote. Please check your permissions and URL."
    exit 1
fi

cd ..

echo ""
echo "Step 4: Linking as Submodule"
echo "----------------------------"
echo "Adding submodule reference..."

# We need to force add it because it's already in the work tree
git submodule add --force "$REPO_URL" "$PRIVATE_DIR"

echo ""
echo "✅ Success! Private submodule setup complete."
echo ""
echo "Next steps:"
echo "1. Commit the submodule addition to the main repo:"
echo "   git add .gitmodules private"
echo "   git commit -m \"Add private submodule\""
echo ""
