// Quick setup script for testing
// Run with: node test-scripts/quick-setup.js

const TEST_PROFILES = {
  newUser: {
    name: "Test New User",
    seedPhrase: "test wallet seed phrase twelve words here for testing only please ignore",
    password: "testpassword123"
  },
  existingUser: {
    name: "Test Existing User", 
    walletPath: "./test-wallets/test-wallet.json",
    password: "testpassword123",
    driveId: "test-drive-uuid-1234"
  }
};

const TEST_DRIVES = [
  {
    id: "test-drive-uuid-1234",
    name: "Test Drive 1",
    privacy: "public"
  },
  {
    id: "test-drive-uuid-5678",
    name: "Test Drive 2", 
    privacy: "private"
  }
];

// Export for use in other scripts
module.exports = { TEST_PROFILES, TEST_DRIVES };