#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 ArDrive Desktop - Build for Testers\n');

// Detect platform
const platform = process.platform;
const platformName = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';

console.log(`📦 Building for ${platformName}...\n`);

// Clean previous builds
console.log('🧹 Cleaning previous builds...');
try {
  execSync('npm run clean', { stdio: 'inherit' });
} catch (error) {
  console.log('Clean failed, continuing...');
}

// Install dependencies
console.log('\n📥 Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

// Build the app
console.log('\n🔨 Building application...');
execSync('npm run build', { stdio: 'inherit' });

// Create distributables
console.log('\n📦 Creating installer packages...');
execSync('npm run dist', { stdio: 'inherit' });

// Find and display output files
console.log('\n✅ Build complete! Distribution files:\n');

const releaseDir = path.join(process.cwd(), 'release');
if (fs.existsSync(releaseDir)) {
  const files = fs.readdirSync(releaseDir);
  
  const installers = files.filter(f => 
    f.endsWith('.exe') || 
    f.endsWith('.dmg') || 
    f.endsWith('.zip') || 
    f.endsWith('.AppImage') ||
    f.endsWith('.deb')
  );
  
  if (installers.length > 0) {
    console.log('📁 Files ready for distribution:');
    installers.forEach(file => {
      const filePath = path.join(releaseDir, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   • ${file} (${sizeMB} MB)`);
    });
    
    console.log(`\n📍 Location: ${releaseDir}`);
    console.log('\n🚀 Share these files with your testers!');
    
    // Platform-specific instructions
    if (platform === 'win32') {
      console.log('\n💡 Windows testers should use the .exe installer');
    } else if (platform === 'darwin') {
      console.log('\n💡 Mac testers can use either:');
      console.log('   • .dmg for standard installation');
      console.log('   • .zip for portable/quick testing');
    }
  } else {
    console.log('⚠️  No installer files found in release directory');
  }
} else {
  console.log('⚠️  Release directory not found');
}