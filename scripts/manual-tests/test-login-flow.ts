#!/usr/bin/env ts-node

// Test script to verify login flow with existing profile
// This tests the bug where users with existing profiles are shown the sync folder setup again

import { ProfileManager } from '../src/main/profile-manager';
import { ConfigManager } from '../src/main/config-manager';
import { WalletManager } from '../src/main/wallet-manager-secure';
import { app } from 'electron';
import * as path from 'path';

// Mock app.getPath for testing
app.getPath = (name: string) => {
  if (name === 'userData') {
    return path.join(__dirname, '../test-data');
  }
  return '';
};

async function testLoginFlow() {
  console.log('=== Testing Login Flow with Existing Profile ===\n');

  const profileManager = new ProfileManager();
  const configManager = new ConfigManager();
  const walletManager = new WalletManager();

  // Test Case 1: New Profile Setup
  console.log('1. Creating new profile...');
  const profileId = await profileManager.createProfile('Test User');
  console.log(`   Profile created: ${profileId}`);

  // Set active profile
  await profileManager.setActiveProfile(profileId);
  configManager.setActiveProfile(profileId);

  // Simulate initial setup
  const config = configManager.getConfig();
  console.log(`   Initial config - isFirstRun: ${config.isFirstRun}`);

  // Simulate completing wallet setup and drive selection
  console.log('\n2. Simulating wallet and drive setup...');
  
  // Legacy setup (single drive)
  configManager.updateConfig({
    isFirstRun: false,
    selectedDriveId: 'test-drive-id',
    syncFolderPath: '/path/to/sync/folder'
  });

  let updatedConfig = configManager.getConfig();
  console.log(`   Config after setup:`);
  console.log(`   - selectedDriveId: ${updatedConfig.selectedDriveId}`);
  console.log(`   - syncFolderPath: ${updatedConfig.syncFolderPath}`);
  console.log(`   - driveMappings: ${JSON.stringify(updatedConfig.driveMappings)}`);

  // Test Case 2: Logout and Login
  console.log('\n3. Simulating logout...');
  // In real app, this would clear the active wallet but keep profile

  console.log('\n4. Simulating login with existing profile...');
  await profileManager.setActiveProfile(profileId);
  configManager.setActiveProfile(profileId);

  // Reload config (simulating what happens on login)
  const loginConfig = configManager.getConfig();
  console.log(`   Config after login:`);
  console.log(`   - isFirstRun: ${loginConfig.isFirstRun}`);
  console.log(`   - selectedDriveId: ${loginConfig.selectedDriveId}`);
  console.log(`   - syncFolderPath: ${loginConfig.syncFolderPath}`);
  console.log(`   - driveMappings: ${JSON.stringify(loginConfig.driveMappings)}`);

  // Check navigation logic conditions
  console.log('\n5. Checking navigation conditions...');
  const hasLegacySetup = loginConfig.selectedDriveId && loginConfig.syncFolderPath;
  const hasDriveMappings = loginConfig.driveMappings && loginConfig.driveMappings.length > 0;
  const hasAnyDriveConfig = hasLegacySetup || hasDriveMappings;

  console.log(`   - hasLegacySetup: ${hasLegacySetup}`);
  console.log(`   - hasDriveMappings: ${hasDriveMappings}`);
  console.log(`   - hasAnyDriveConfig: ${hasAnyDriveConfig}`);

  // Expected behavior
  console.log('\n6. Expected navigation:');
  if (!hasAnyDriveConfig) {
    console.log('   ❌ Would show Drive & Sync setup (BUG!)');
  } else {
    console.log('   ✅ Would show Dashboard (CORRECT)');
  }

  // Test Case 3: After Migration
  console.log('\n7. Testing after config migration...');
  
  // Force migration by clearing and reloading
  const migratedConfig = configManager.getConfig();
  console.log(`   Config after migration:`);
  console.log(`   - selectedDriveId: ${migratedConfig.selectedDriveId}`);
  console.log(`   - syncFolderPath: ${migratedConfig.syncFolderPath}`);
  console.log(`   - driveMappings: ${JSON.stringify(migratedConfig.driveMappings)}`);

  // Check navigation after migration
  const hasLegacySetup2 = migratedConfig.selectedDriveId && migratedConfig.syncFolderPath;
  const hasDriveMappings2 = migratedConfig.driveMappings && migratedConfig.driveMappings.length > 0;
  const hasAnyDriveConfig2 = hasLegacySetup2 || hasDriveMappings2;

  console.log(`   - hasLegacySetup: ${hasLegacySetup2}`);
  console.log(`   - hasDriveMappings: ${hasDriveMappings2}`);
  console.log(`   - hasAnyDriveConfig: ${hasAnyDriveConfig2}`);

  console.log('\n8. Expected navigation after migration:');
  if (!hasAnyDriveConfig2) {
    console.log('   ❌ Would show Drive & Sync setup (BUG!)');
  } else {
    console.log('   ✅ Would show Dashboard (CORRECT)');
  }

  // Cleanup
  console.log('\n9. Cleaning up test data...');
  await profileManager.deleteProfile(profileId);
  console.log('   Test completed!');
}

// Run the test
testLoginFlow().catch(console.error);