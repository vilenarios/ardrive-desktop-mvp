// @vitest-environment node
//
// Migrated from src/main/__tests__/turbo-manager.test.ts (jest) as part of
// INFRA-2. The whole @ardrive/turbo-sdk module is mocked: no network calls,
// no real payment/top-up endpoints are ever reachable from this suite.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurboManager } from '../../../src/main/turbo-manager';
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';

vi.mock('@ardrive/turbo-sdk', () => ({
  TurboFactory: {
    authenticated: vi.fn(),
    unauthenticated: vi.fn(),
  },
  ArweaveSigner: vi.fn().mockImplementation(() => ({
    getNativeAddress: vi.fn(() => Promise.resolve('mock-address'))
  })),
  USD: vi.fn((amount: number) => ({ amount: amount * 100, type: 'usd' })),
  EUR: vi.fn((amount: number) => ({ amount: amount * 100, type: 'eur' })),
  GBP: vi.fn((amount: number) => ({ amount: amount * 100, type: 'gbp' })),
  CAD: vi.fn((amount: number) => ({ amount: amount * 100, type: 'cad' })),
  AUD: vi.fn((amount: number) => ({ amount: amount * 100, type: 'aud' })),
  JPY: vi.fn((amount: number) => ({ amount: amount, type: 'jpy' })),
  INR: vi.fn((amount: number) => ({ amount: amount * 100, type: 'inr' })),
  SGD: vi.fn((amount: number) => ({ amount: amount * 100, type: 'sgd' })),
  HKD: vi.fn((amount: number) => ({ amount: amount * 100, type: 'hkd' })),
  BRL: vi.fn((amount: number) => ({ amount: amount * 100, type: 'brl' })),
}));

describe('TurboManager', () => {
  let turboManager: TurboManager;
  let mockAuthenticatedClient: any;
  let mockUnauthenticatedClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthenticatedClient = {
      getBalance: vi.fn(),
      upload: vi.fn(),
      uploadFile: vi.fn(),
      createCheckoutSession: vi.fn(),
      topUpWithTokens: vi.fn(),
      signer: {
        getNativeAddress: vi.fn(() => Promise.resolve('mock-address')),
      },
    };

    mockUnauthenticatedClient = {
      getUploadCosts: vi.fn(),
      getFiatEstimateForBytes: vi.fn(),
    };

    vi.mocked(TurboFactory.authenticated).mockReturnValue(mockAuthenticatedClient);
    vi.mocked(TurboFactory.unauthenticated).mockReturnValue(mockUnauthenticatedClient);
    vi.mocked(ArweaveSigner).mockImplementation(
      () =>
        ({
          getNativeAddress: vi.fn(() => Promise.resolve('mock-address')),
        }) as any
    );

    turboManager = new TurboManager();
  });

  describe('initialization', () => {
    it('should initialize with a wallet', async () => {
      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };

      await expect(turboManager.initialize(mockJwk)).resolves.not.toThrow();
      expect(turboManager.isInitialized()).toBe(true);
    });

    it('should handle initialization errors', async () => {
      // Once-only so the broken signer does not leak into later tests
      vi.mocked(ArweaveSigner).mockImplementationOnce(() => {
        throw new Error('Mock signer error');
      });

      const mockJwk = { kty: 'RSA', n: 'mock-n', e: 'AQAB' };

      await expect(turboManager.initialize(mockJwk)).rejects.toThrow('Failed to initialize Turbo client');
      expect(turboManager.isInitialized()).toBe(false);
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

    it('should fall back to USD for an unsupported currency', async () => {
      const mockEstimate = { amount: 10, winc: '1000000000000', currency: 'usd' };
      mockUnauthenticatedClient.getFiatEstimateForBytes.mockResolvedValue(mockEstimate);

      await turboManager.getFiatEstimate(1024, 'invalid');

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
      expect(mockAuthenticatedClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.objectContaining({
            amount: 1000, // 10 USD in cents
            type: 'usd'
          }),
          owner: 'mock-address'
        })
      );
    });

    it('should reject a session response without a checkout URL', async () => {
      mockAuthenticatedClient.createCheckoutSession.mockResolvedValue({ id: 'cs_test_123' });

      await expect(turboManager.createCheckoutSession(10, 'USD')).rejects.toThrow(
        'Failed to create checkout session'
      );
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
