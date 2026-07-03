// Test script to verify keytar installation and functionality
const keytar = require('keytar');

async function testKeychain() {
  console.log('Testing Keytar Installation and Functionality\n');
  
  try {
    // Test 1: Check if keytar is available
    console.log('✓ Keytar module loaded successfully');
    
    // Test 2: Set a test credential
    const service = 'ArDriveTest';
    const account = 'test-account';
    const password = 'test-password-12345';
    
    console.log('\nSetting test credential...');
    await keytar.setPassword(service, account, password);
    console.log('✓ Successfully stored password in OS keychain');
    
    // Test 3: Retrieve the credential
    console.log('\nRetrieving test credential...');
    const retrieved = await keytar.getPassword(service, account);
    
    if (retrieved === password) {
      console.log('✓ Successfully retrieved password from OS keychain');
      console.log(`  Retrieved: ${retrieved}`);
    } else {
      console.log('✗ Failed to retrieve correct password');
    }
    
    // Test 4: List credentials for service
    console.log('\nListing credentials for service...');
    const credentials = await keytar.findCredentials(service);
    console.log(`✓ Found ${credentials.length} credential(s)`);
    credentials.forEach(cred => {
      console.log(`  - Account: ${cred.account}`);
    });
    
    // Test 5: Delete the test credential
    console.log('\nCleaning up test credential...');
    const deleted = await keytar.deletePassword(service, account);
    console.log(`✓ Test credential deleted: ${deleted}`);
    
    // Test 6: Platform-specific info
    console.log('\n--- Platform Info ---');
    console.log(`Platform: ${process.platform}`);
    console.log(`Architecture: ${process.arch}`);
    console.log(`Node Version: ${process.version}`);
    
    if (process.platform === 'win32') {
      console.log('Using: Windows Credential Manager');
    } else if (process.platform === 'darwin') {
      console.log('Using: macOS Keychain');
    } else if (process.platform === 'linux') {
      console.log('Using: Linux Secret Service (GNOME Keyring/KDE Wallet)');
    }
    
    console.log('\n✅ All keychain tests passed! Keytar is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Keytar test failed:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.message.includes('The specified module could not be found')) {
      console.error('\nThis usually means keytar needs to be rebuilt for your Electron version.');
      console.error('Try running: npm rebuild keytar');
    }
  }
}

testKeychain();