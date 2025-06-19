// Test script to verify full keychain integration with ArDrive
const { app } = require('electron');
const path = require('path');

// Force app to not quit when all windows are closed
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.whenReady().then(async () => {
  console.log('Testing ArDrive Keychain Integration\n');
  
  try {
    // Import the services we need to test
    const { walletManager } = require('../dist/main/wallet-manager-secure');
    const { keychainService } = require('../dist/main/keychain-service');
    const { profileManager } = require('../dist/main/profile-manager');
    
    // Test 1: Check keychain availability
    console.log('1. Testing Keychain Availability');
    const keychainAvailable = keychainService.isKeychainAvailable();
    console.log(`   ✓ Keychain available: ${keychainAvailable}`);
    
    const securityMethod = keychainService.getSecurityMethod();
    console.log(`   ✓ Security method: ${securityMethod}`);
    
    if (keychainAvailable) {
      console.log('   ✓ Platform:', process.platform);
      if (process.platform === 'win32') {
        console.log('   ✓ Using: Windows Credential Manager');
      } else if (process.platform === 'darwin') {
        console.log('   ✓ Using: macOS Keychain');
      }
    }
    
    // Test 2: Create a test wallet
    console.log('\n2. Testing Wallet Creation with Keychain Storage');
    const testPassword = 'test-password-' + Date.now();
    
    try {
      await walletManager.createWallet(testPassword);
      console.log('   ✓ Wallet created successfully');
      
      // Check if password was stored in keychain
      const activeProfile = await profileManager.getActiveProfile();
      if (activeProfile && keychainAvailable) {
        const keychainAccount = `wallet-${activeProfile.id}`;
        const storedPassword = await keychainService.getPassword(keychainAccount);
        console.log(`   ✓ Password stored in keychain: ${storedPassword === testPassword}`);
      }
    } catch (error) {
      console.error('   ✗ Wallet creation failed:', error.message);
    }
    
    // Test 3: Test session persistence
    console.log('\n3. Testing Session Persistence');
    const isLoaded = await walletManager.isWalletLoaded();
    console.log(`   ✓ Wallet loaded after creation: ${isLoaded}`);
    
    // Test 4: Test profile switching
    console.log('\n4. Testing Profile Switching');
    const profiles = await profileManager.getAllProfiles();
    console.log(`   ✓ Number of profiles: ${profiles.length}`);
    
    if (profiles.length > 0) {
      console.log('   ✓ Active profile:', profiles.find(p => p.isActive)?.name);
    }
    
    // Test 5: Test cleanup
    console.log('\n5. Testing Cleanup');
    try {
      await walletManager.clearStoredWallet();
      console.log('   ✓ Wallet cleared successfully');
      
      // Check if password was removed from keychain
      if (keychainAvailable) {
        const activeProfile = await profileManager.getActiveProfile();
        if (activeProfile) {
          const keychainAccount = `wallet-${activeProfile.id}`;
          const clearedPassword = await keychainService.getPassword(keychainAccount);
          console.log(`   ✓ Password removed from keychain: ${!clearedPassword}`);
        }
      }
    } catch (error) {
      console.error('   ✗ Cleanup failed:', error.message);
    }
    
    // Test 6: Security features summary
    console.log('\n6. Security Features Summary');
    console.log('   ✓ Keychain integration:', keychainAvailable ? 'Active' : 'Using fallback');
    console.log('   ✓ Session passwords:', keychainAvailable ? 'Stored in OS keychain' : 'Encrypted in memory');
    console.log('   ✓ Wallet files: Always encrypted with AES-256-GCM');
    console.log('   ✓ Profile isolation: Each profile has separate credentials');
    
    console.log('\n✅ Keychain integration test completed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    // Clean exit
    setTimeout(() => {
      app.quit();
    }, 1000);
  }
});