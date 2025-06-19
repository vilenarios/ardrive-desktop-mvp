#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 ArDrive Desktop - Build Installers Script');
console.log('============================================\n');

// Check if we're in the right directory
if (!fs.existsSync('package.json')) {
  console.error('❌ Error: Must run from project root directory');
  process.exit(1);
}

// Read package.json to get version
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

console.log(`📦 Building ArDrive Desktop v${version}\n`);

// Helper function to run commands
function runCommand(command, description) {
  console.log(`⏳ ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} completed\n`);
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    process.exit(1);
  }
}

// Get platform argument
const platform = process.argv[2];

try {
  // Clean previous builds
  runCommand('npm run clean', 'Cleaning previous builds');
  
  // Build the application
  runCommand('npm run build', 'Building application');
  
  // Build installers based on platform
  switch (platform) {
    case 'windows':
    case 'win':
      runCommand('npm run dist:win', 'Building Windows installer');
      console.log('🎉 Windows installer created!');
      console.log('📁 Check the release/ folder for:');
      console.log('   - ArDrive Desktop Setup.exe (NSIS installer)');
      console.log('   - ArDrive Desktop.exe (Portable executable)');
      break;
      
    case 'macos':
    case 'mac':
      runCommand('npm run dist:mac', 'Building macOS installer');
      console.log('🎉 macOS installer created!');
      console.log('📁 Check the release/ folder for:');
      console.log('   - ArDrive Desktop.dmg (Disk image)');
      console.log('   - ArDrive Desktop-mac.zip (Archive)');
      break;
      
    case 'linux':
      runCommand('npm run dist:linux', 'Building Linux installer');
      console.log('🎉 Linux installer created!');
      console.log('📁 Check the release/ folder for:');
      console.log('   - ArDrive Desktop.AppImage (Universal Linux app)');
      console.log('   - ArDrive Desktop.deb (Debian package)');
      break;
      
    case 'all':
      runCommand('npm run dist:all', 'Building installers for all platforms');
      console.log('🎉 All installers created!');
      console.log('📁 Check the release/ folder for all platform installers');
      break;
      
    default:
      console.log('Usage: node scripts/build-installers.js [platform]');
      console.log('');
      console.log('Platforms:');
      console.log('  windows, win    - Build Windows installer (.exe)');
      console.log('  macos, mac      - Build macOS installer (.dmg)');
      console.log('  linux           - Build Linux installer (.AppImage, .deb)');
      console.log('  all             - Build for all platforms');
      console.log('');
      console.log('Examples:');
      console.log('  npm run build-installer windows');
      console.log('  npm run build-installer mac');
      console.log('  npm run build-installer all');
      break;
  }

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

console.log('\n🚀 Build complete!');
console.log('\n📋 Next steps:');
console.log('1. Test the installer on the target platform');
console.log('2. Upload to GitHub releases');
console.log('3. Share with users!');