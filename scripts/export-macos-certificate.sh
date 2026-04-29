#!/bin/bash

# macOS Certificate Export Script for GitHub Actions
# This script helps export your code signing certificate for use in GitHub Actions

set -e

echo "🔐 macOS Certificate Export Script for GitHub Actions"
echo "=================================================="

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script must be run on macOS"
    exit 1
fi

# List available certificates
echo "📋 Available code signing certificates:"
echo "----------------------------------------"
security find-identity -v -p codesigning

echo ""
echo "🔍 Looking for Developer ID Application certificate..."

# Try to find the certificate automatically
CERT_NAME=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')

if [ -z "$CERT_NAME" ]; then
    echo "❌ No Developer ID Application certificate found"
    echo "💡 Make sure you have a valid Developer ID Application certificate in your keychain"
    exit 1
fi

echo "✅ Found certificate: $CERT_NAME"

# Ask for confirmation
echo ""
read -p "Do you want to export this certificate? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Export cancelled"
    exit 1
fi

# Ask for password
echo ""
read -s -p "Enter password for the certificate (will not be displayed): " CERT_PASSWORD
echo ""

# Export the certificate
echo ""
echo "📦 Exporting certificate..."
security export -k login.keychain -t identities -f pkcs12 -o certificate.p12 "$CERT_NAME" <<< "$CERT_PASSWORD"

if [ $? -eq 0 ]; then
    echo "✅ Certificate exported successfully to certificate.p12"
else
    echo "❌ Failed to export certificate"
    exit 1
fi

# Base64 encode the certificate
echo ""
echo "🔢 Base64 encoding certificate..."
BASE64_CERT=$(base64 -i certificate.p12)

# Create the secrets file
echo ""
echo "📝 Creating GitHub secrets template..."
cat > github-secrets-template.txt << EOF
# GitHub Secrets Template
# Copy these values to your GitHub repository secrets

# macOS Certificate (P12 file content, base64 encoded)
MACOS_CERTIFICATE_P12=$BASE64_CERT

# macOS Certificate Password
MACOS_CERTIFICATE_PASSWORD=$CERT_PASSWORD

# macOS Certificate Name
MACOS_CERTIFICATE_NAME="$CERT_NAME"

# Apple ID (replace with your actual Apple ID)
APPLE_ID=your-apple-id@example.com

# Apple App-Specific Password (generate at https://appleid.apple.com/account/manage)
APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password

# Apple Team ID (extracted from certificate name)
APPLE_TEAM_ID=$(echo "$CERT_NAME" | grep -o '[A-Z0-9]\{10\}' | head -1)

# Windows Certificate (if you have one)
# WINDOWS_CERTIFICATE_PFX=your-base64-encoded-pfx-file

# Windows Certificate Password
# WINDOWS_CERTIFICATE_PASSWORD=your-pfx-password
EOF

echo "✅ GitHub secrets template created: github-secrets-template.txt"
echo ""
echo "📋 Next steps:"
echo "1. Edit github-secrets-template.txt and fill in your Apple ID credentials"
echo "2. Go to your GitHub repository → Settings → Secrets and variables → Actions"
echo "3. Add each secret from the template"
echo "4. Test the workflow with a manual trigger"
echo ""
echo "🔒 Security notes:"
echo "- Keep certificate.p12 and github-secrets-template.txt secure"
echo "- Delete certificate.p12 after adding secrets to GitHub"
echo "- Never commit these files to your repository"
echo ""
echo "🧹 Cleaning up..."
rm certificate.p12
echo "✅ Done!"
