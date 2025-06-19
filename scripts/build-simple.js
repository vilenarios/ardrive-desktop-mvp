#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 ArDrive Desktop - Simple Build Script');
console.log('=====================================\n');

// Helper function to run commands with better error handling
function runCommand(command, description) {
  console.log(`⏳ ${description}...`);
  try {
    const output = execSync(command, { 
      stdio: 'pipe',
      encoding: 'utf8',
      env: { 
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false', // Disable code signing
        DEBUG: '' // Reduce debug output
      }
    });
    console.log(`✅ ${description} completed\n`);
    return output;
  } catch (error) {
    console.error(`❌ ${description} failed:`);
    console.error(error.stdout);
    console.error(error.stderr);
    console.error('\n💡 Try the manual build approach in BUILD_INSTALLERS.md');
    process.exit(1);
  }
}

async function main() {
  try {
    // Clean and build
    console.log('🧹 Cleaning previous builds...');
    try {
      execSync('npm run clean', { stdio: 'pipe' });
    } catch (e) {
      // Ignore clean errors
    }
    
    console.log('🔨 Building application...');
    runCommand('npm run build', 'Building TypeScript and React');
    
    // Try to build for current platform only
    console.log('📦 Creating installer for current platform...');
    
    // Detect platform
    const platform = process.platform;
    let buildCommand;
    
    switch (platform) {
      case 'win32':
        buildCommand = 'npx electron-builder --win --publish=never';
        break;
      case 'darwin':
        buildCommand = 'npx electron-builder --mac --publish=never';
        break;
      case 'linux':
        buildCommand = 'npx electron-builder --linux --publish=never';
        break;
      default:
        console.error(`❌ Unsupported platform: ${platform}`);
        process.exit(1);
    }
    
    console.log(`Building for ${platform}...`);
    runCommand(buildCommand, `Creating ${platform} installer`);
    
    // Check what was created
    const releaseDir = 'release';
    if (fs.existsSync(releaseDir)) {
      const files = fs.readdirSync(releaseDir);
      console.log('🎉 Build completed successfully!');
      console.log('\n📁 Created files:');
      files.forEach(file => {
        const filePath = path.join(releaseDir, file);
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        console.log(`   📄 ${file} (${sizeMB} MB)`);
      });
      
      console.log('\n🚀 Ready for distribution!');
      console.log('\n📋 Next steps:');
      console.log('1. Test the installer on target platforms');
      console.log('2. Upload to GitHub releases');
      console.log('3. Share with users!');
    } else {
      console.warn('⚠️  Build completed but no release folder found');
    }
    
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    console.log('\n💡 Troubleshooting tips:');
    console.log('1. Make sure all dependencies are installed: npm install');
    console.log('2. Try clearing cache: npm cache clean --force');
    console.log('3. Check BUILD_INSTALLERS.md for platform-specific instructions');
    process.exit(1);
  }
}

main();