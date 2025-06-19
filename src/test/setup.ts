import '@testing-library/jest-dom';

// Mock electron APIs
const mockElectronAPI = {
  wallet: {
    loadWallet: jest.fn(),
    getWalletInfo: jest.fn(),
    logout: jest.fn(),
  },
  drive: {
    getDrives: jest.fn(),
    selectDrive: jest.fn(),
  },
  sync: {
    setSyncFolder: jest.fn(),
    startSync: jest.fn(),
    stopSync: jest.fn(),
    getSyncStatus: jest.fn(),
    getUploads: jest.fn(),
    getPendingUploads: jest.fn(),
    approveUpload: jest.fn(),
    rejectUpload: jest.fn(),
  },
  turbo: {
    getBalance: jest.fn(),
    getUploadCosts: jest.fn(),
    getFiatEstimate: jest.fn(),
    createCheckoutSession: jest.fn(),
    topUpWithTokens: jest.fn(),
    isInitialized: jest.fn(),
    getStatus: jest.fn(),
  },
  payment: {
    openWindow: jest.fn(),
    onPaymentCompleted: jest.fn(),
    removePaymentCompletedListener: jest.fn(),
  },
  dialog: {
    selectFolder: jest.fn(),
    selectWallet: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
  onWalletInfoUpdated: jest.fn(),
  removeWalletInfoUpdatedListener: jest.fn(),
};

// Mock the global electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Mock crypto for tests
Object.defineProperty(global, 'crypto', {
  value: {
    getRandomValues: (arr: any) => arr.fill(0),
    randomUUID: () => 'test-uuid-1234',
  },
});

// Suppress console errors in tests unless needed
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render is deprecated')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Reset all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});