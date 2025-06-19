import { TurboManager } from '../turbo-manager';

// Mock the entire @ardrive/turbo-sdk module
jest.mock('@ardrive/turbo-sdk', () => ({
  TurboFactory: {
    authenticated: jest.fn(),
    unauthenticated: jest.fn(),
  },
  ArweaveSigner: jest.fn().mockImplementation((jwk) => ({
    getNativeAddress: jest.fn(() => Promise.resolve('mock-address'))
  })),
  USD: jest.fn((amount) => ({
    amount: amount * 100, // Mock converting to cents
    type: 'usd'
  })),
  EUR: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'eur'
  })),
  GBP: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'gbp'
  })),
  CAD: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'cad'
  })),
  AUD: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'aud'
  })),
  JPY: jest.fn((amount) => ({
    amount: amount,
    type: 'jpy'
  })),
  INR: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'inr'
  })),
  SGD: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'sgd'
  })),
  HKD: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'hkd'
  })),
  BRL: jest.fn((amount) => ({
    amount: amount * 100,
    type: 'brl'
  })),
}));

describe('TurboManager', () => {
  let turboManager: TurboManager;
  let mockAuthenticatedClient: any;
  let mockUnauthenticatedClient: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock clients
    mockAuthenticatedClient = {
      getBalance: jest.fn(),
      upload: jest.fn(),
      uploadFile: jest.fn(),
      createCheckoutSession: jest.fn(),
      topUpWithTokens: jest.fn(),
      signer: {
        getNativeAddress: jest.fn(() => Promise.resolve('mock-address')),
      },
    };

    mockUnauthenticatedClient = {
      getUploadCosts: jest.fn(),
      getFiatEstimateForBytes: jest.fn(),
    };

    // Mock factory methods
    const { TurboFactory } = require('@ardrive/turbo-sdk');
    TurboFactory.authenticated.mockReturnValue(mockAuthenticatedClient);
    TurboFactory.unauthenticated.mockReturnValue(mockUnauthenticatedClient);

    turboManager = new TurboManager();
  });

  describe('initialization', () => {
    it('should initialize with a wallet', async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      
      await expect(turboManager.initialize(mockJwk)).resolves.not.toThrow();
      expect(turboManager.isInitialized()).toBe(true);
    });

    it('should handle initialization errors', async () => {
      const { ArweaveSigner } = require('@ardrive/turbo-sdk');
      ArweaveSigner.mockImplementation(() => {
        throw new Error('Mock signer error');
      });

      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      
      await expect(turboManager.initialize(mockJwk)).rejects.toThrow('Failed to initialize Turbo client');
    });

    it('should not be initialized before initialize is called', () => {
      expect(turboManager.isInitialized()).toBe(false);
    });
  });

  describe('balance operations', () => {
    beforeEach(async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      await turboManager.initialize(mockJwk);
    });

    it('should get balance successfully', async () => {
      const mockBalance = { winc: '1000000000000' }; // 1 AR in winston
      mockAuthenticatedClient.getBalance.mockResolvedValue(mockBalance);

      const result = await turboManager.getBalance();
      
      expect(result).toEqual({
        winc: '1000000000000',
        ar: '1.000000'
      });
      expect(mockAuthenticatedClient.getBalance).toHaveBeenCalled();
    });

    it('should handle balance fetch errors', async () => {
      mockAuthenticatedClient.getBalance.mockRejectedValue(new Error('Network error'));

      await expect(turboManager.getBalance()).rejects.toThrow('Failed to get Turbo Credits balance');
    });

    it('should throw error when not initialized', async () => {
      const uninitializedManager = new TurboManager();
      
      await expect(uninitializedManager.getBalance()).rejects.toThrow('Turbo not initialized');
    });
  });

  describe('cost estimation', () => {
    it('should get upload costs', async () => {
      const mockCosts = [{ winc: '1000', adjustments: [] }];
      mockUnauthenticatedClient.getUploadCosts.mockResolvedValue(mockCosts);

      const result = await turboManager.getUploadCosts(1024);
      
      expect(result).toEqual({
        winc: '1000',
        adjustments: []
      });
      expect(mockUnauthenticatedClient.getUploadCosts).toHaveBeenCalledWith({ bytes: [1024] });
    });

    it('should get fiat estimates', async () => {
      const mockEstimate = { amount: 10, winc: '1000000000000', currency: 'usd' };
      mockUnauthenticatedClient.getFiatEstimateForBytes.mockResolvedValue(mockEstimate);

      const result = await turboManager.getFiatEstimate(1024, 'usd');
      
      expect(result).toEqual(mockEstimate);
      expect(mockUnauthenticatedClient.getFiatEstimateForBytes).toHaveBeenCalledWith({
        byteCount: 1024,
        currency: 'usd'
      });
    });

    it('should handle unsupported currency', async () => {
      const mockEstimate = { amount: 10, winc: '1000000000000', currency: 'usd' };
      mockUnauthenticatedClient.getFiatEstimateForBytes.mockResolvedValue(mockEstimate);

      const result = await turboManager.getFiatEstimate(1024, 'invalid');
      
      expect(mockUnauthenticatedClient.getFiatEstimateForBytes).toHaveBeenCalledWith({
        byteCount: 1024,
        currency: 'usd' // Should fallback to USD
      });
    });
  });

  describe('checkout session creation', () => {
    beforeEach(async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      await turboManager.initialize(mockJwk);
    });

    it('should create checkout session successfully', async () => {
      const mockSession = {
        url: 'https://checkout.stripe.com/test',
        id: 'cs_test_123',
        paymentAmount: 1000
      };
      mockAuthenticatedClient.createCheckoutSession.mockResolvedValue(mockSession);

      const result = await turboManager.createCheckoutSession(10, 'USD');
      
      expect(result).toEqual(mockSession);
      expect(mockAuthenticatedClient.createCheckoutSession).toHaveBeenCalledWith({
        amount: expect.objectContaining({
          amount: 1000, // 10 USD in cents
          type: 'usd'
        }),
        owner: 'mock-address',
        uiMode: 'embedded'
      });
    });

    it('should handle checkout session errors', async () => {
      mockAuthenticatedClient.createCheckoutSession.mockRejectedValue(new Error('Payment error'));

      await expect(turboManager.createCheckoutSession(10, 'USD')).rejects.toThrow('Failed to create checkout session');
    });

    it('should use default currency when none provided', async () => {
      const mockSession = { url: 'https://checkout.stripe.com/test', id: 'cs_test_123' };
      mockAuthenticatedClient.createCheckoutSession.mockResolvedValue(mockSession);

      await turboManager.createCheckoutSession(10);
      
      expect(mockAuthenticatedClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.objectContaining({
            type: 'usd'
          })
        })
      );
    });
  });

  describe('upload operations', () => {
    beforeEach(async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      await turboManager.initialize(mockJwk);
    });

    it('should upload data successfully', async () => {
      const mockResult = {
        id: 'upload-id-123',
        owner: 'mock-address',
        dataCaches: [],
        fastFinalityIndexes: []
      };
      mockAuthenticatedClient.upload.mockResolvedValue(mockResult);

      const testData = Buffer.from('test data');
      const testTags = [{ name: 'Content-Type', value: 'text/plain' }];
      
      const result = await turboManager.uploadData(testData, testTags);
      
      expect(result).toEqual(mockResult);
      expect(mockAuthenticatedClient.upload).toHaveBeenCalledWith({
        data: testData,
        dataItemOpts: { tags: testTags },
        events: expect.objectContaining({
          onProgress: expect.any(Function),
          onError: expect.any(Function),
          onSuccess: expect.any(Function)
        })
      });
    });

    it('should handle upload errors', async () => {
      mockAuthenticatedClient.upload.mockRejectedValue(new Error('Upload failed'));

      const testData = Buffer.from('test data');
      
      await expect(turboManager.uploadData(testData)).rejects.toThrow('Failed to upload data with Turbo Credits');
    });
  });

  describe('token top-up', () => {
    beforeEach(async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      await turboManager.initialize(mockJwk);
    });

    it('should top up with tokens successfully', async () => {
      const mockResult = { transactionId: 'tx-123' };
      mockAuthenticatedClient.topUpWithTokens.mockResolvedValue(mockResult);

      const result = await turboManager.topUpWithTokens(1.5); // 1.5 AR
      
      expect(result).toEqual(mockResult);
      expect(mockAuthenticatedClient.topUpWithTokens).toHaveBeenCalledWith({
        tokenAmount: 1500000000000, // 1.5 AR in winston
        feeMultiplier: 1.0
      });
    });

    it('should handle custom fee multiplier', async () => {
      const mockResult = { transactionId: 'tx-123' };
      mockAuthenticatedClient.topUpWithTokens.mockResolvedValue(mockResult);

      await turboManager.topUpWithTokens(1.0, 2.0);
      
      expect(mockAuthenticatedClient.topUpWithTokens).toHaveBeenCalledWith({
        tokenAmount: 1000000000000,
        feeMultiplier: 2.0
      });
    });
  });

  describe('reset', () => {
    it('should reset the manager state', async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };
      await turboManager.initialize(mockJwk);
      
      expect(turboManager.isInitialized()).toBe(true);
      
      turboManager.reset();
      
      expect(turboManager.isInitialized()).toBe(false);
    });
  });
});