#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 ArDrive Desktop MVP - Build Validation');
console.log('=====================================\n');

const checks = [
  {
    name: 'Package.json exists',
    check: () => fs.existsSync('package.json'),
    fix: 'Run npm init to create package.json'
  },
  {
    name: 'Node modules installed',
    check: () => fs.existsSync('node_modules'),
    fix: 'Run npm install to install dependencies'
  },
  {
    name: 'TypeScript config exists',
    check: () => fs.existsSync('tsconfig.json'),
    fix: 'Create tsconfig.json file'
  },
  {
    name: 'Main process source exists',
    check: () => fs.existsSync('src/main/main.ts'),
    fix: 'Create src/main/main.ts file'
  },
  {
    name: 'Renderer source exists',
    check: () => fs.existsSync('src/renderer/index.tsx'),
    fix: 'Create src/renderer/index.tsx file'
  },
  {
    name: 'Webpack config exists',
    check: () => fs.existsSync('webpack.renderer.js'),
    fix: 'Create webpack.renderer.js file'
  }
];

let passed = 0;
let failed = 0;

checks.forEach(({ name, check, fix }) => {
  const result = check();
  if (result) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    console.log(`   Fix: ${fix}`);
    failed++;
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n🎉 Build validation passed! Ready for testing.');
  console.log('\nNext steps:');
  console.log('1. Run: npm run typecheck');
  console.log('2. Run: npm run build');
  console.log('3. Run: npm run dev (in one terminal)');
  console.log('4. Run: npm start (in another terminal)');
} else {
  console.log('\n⚠️  Please fix the issues above before testing.');
  process.exit(1);
}