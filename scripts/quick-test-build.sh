#!/bin/bash

# ArDrive Desktop - Quick Test Build Script
# For macOS/Linux users

echo "🚀 ArDrive Desktop - Quick Test Build"
echo ""

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="Linux"
else
    PLATFORM="Unknown"
fi

echo "📦 Building for $PLATFORM..."
echo ""

# Clean and build
echo "🧹 Cleaning previous builds..."
npm run clean 2>/dev/null || true

echo ""
echo "📥 Installing dependencies..."
npm install

echo ""
echo "🔨 Building application..."
npm run build

echo ""
echo "📦 Creating installer packages..."
npm run dist

echo ""
echo "✅ Build complete!"
echo ""

# List output files
if [ -d "release" ]; then
    echo "📁 Distribution files created:"
    ls -lh release/*.{dmg,zip,AppImage,deb} 2>/dev/null | awk '{print "   • " $9 " (" $5 ")"}'
    echo ""
    echo "📍 Location: $(pwd)/release"
    echo ""
    echo "🚀 Share these files with your testers!"
else
    echo "⚠️  Release directory not found"
fi