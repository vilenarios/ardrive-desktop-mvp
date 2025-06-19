const { walletManager } = require('../dist/main/wallet-manager-secure');

async function testWalletImport() {
  console.log('Testing wallet import from seed phrase...\n');
  
  // Test seed phrase (DO NOT USE IN PRODUCTION)
  const testSeedPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testPassword = 'test123';
  
  try {
    console.log('1. Importing wallet from seed phrase...');
    const result = await walletManager.importFromSeedPhrase(testSeedPhrase, testPassword);
    console.log('   Import result:', result);
    
    console.log('\n2. Checking if wallet is loaded...');
    const isLoaded = walletManager.isWalletLoaded();
    console.log('   Wallet loaded:', isLoaded);
    
    console.log('\n3. Getting wallet info...');
    const walletInfo = await walletManager.getWalletInfo();
    console.log('   Wallet info:', walletInfo ? {
      address: walletInfo.address.slice(0, 8) + '...' + walletInfo.address.slice(-8),
      balance: walletInfo.balance,
      walletType: walletInfo.walletType
    } : null);
    
    console.log('\n4. Listing drives...');
    try {
      const drives = await walletManager.listDrives();
      console.log('   Drives found:', drives.length);
      drives.forEach((drive, index) => {
        console.log(`   Drive ${index + 1}: ${drive.name} (${drive.privacy})`);
      });
    } catch (driveError) {
      console.log('   Drive listing error:', driveError.message);
    }
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testWalletImport();