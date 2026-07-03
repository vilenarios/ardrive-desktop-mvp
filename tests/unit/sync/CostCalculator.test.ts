// @vitest-environment node
//
// MONEY-3: CostCalculator must never fabricate a Turbo quote. When no real
// quote is available (Turbo not initialized, or the quote fetch fails) the
// result is `estimatedTurboCost: null` — an explicit "estimate unavailable"
// state — never a synthetic number (the old code displayed
// `estimatedCost * 1.1` as if it were a real quote).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostCalculator } from '@/main/sync/CostCalculator';
import { turboManager } from '@/main/turbo-manager';

vi.mock('@/main/turbo-manager', () => ({
  turboManager: {
    isInitialized: vi.fn(),
    getUploadCosts: vi.fn(),
    getBalance: vi.fn(),
  },
}));

const mockTurboManager = vi.mocked(turboManager);

const FILE_SIZE_5MB = 5 * 1024 * 1024;

describe('CostCalculator', () => {
  let calculator: CostCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calculator = new CostCalculator();
  });

  describe('calculateUploadCosts — unavailable states (no fabricated quotes)', () => {
    it('returns null Turbo estimate when Turbo is not initialized', async () => {
      mockTurboManager.isInitialized.mockReturnValue(false);

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      // Explicit "estimate unavailable" — NOT the old fabricated ×1.1 number
      expect(result.estimatedTurboCost).toBeNull();
      expect(result.hasSufficientTurboBalance).toBe(false);
      expect(result.recommendedMethod).toBe('ar');
      expect(mockTurboManager.getUploadCosts).not.toHaveBeenCalled();
    });

    it('returns null Turbo estimate when the quote fetch throws', async () => {
      mockTurboManager.isInitialized.mockReturnValue(true);
      mockTurboManager.getUploadCosts.mockRejectedValue(new Error('network down'));

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      expect(result.estimatedTurboCost).toBeNull();
      expect(result.hasSufficientTurboBalance).toBe(false);
      expect(result.recommendedMethod).toBe('ar');
    });

    it('returns null Turbo estimate when the balance check throws mid-flow', async () => {
      mockTurboManager.isInitialized.mockReturnValue(true);
      mockTurboManager.getUploadCosts.mockResolvedValue({ winc: '2000000000' });
      mockTurboManager.getBalance.mockRejectedValue(new Error('balance service down'));

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      // Conservative: any failure in the quote flow reports "unavailable"
      // rather than a value the user cannot act on.
      expect(result.estimatedTurboCost).toBeNull();
      expect(result.hasSufficientTurboBalance).toBe(false);
    });

    it('never returns the old synthetic ×1.1 fallback in any failure mode', async () => {
      const syntheticQuote = (FILE_SIZE_5MB / 1e12) * 1.1;

      mockTurboManager.isInitialized.mockReturnValue(false);
      const notInitialized = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      mockTurboManager.isInitialized.mockReturnValue(true);
      mockTurboManager.getUploadCosts.mockRejectedValue(new Error('boom'));
      const quoteFailed = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      for (const result of [notInitialized, quoteFailed]) {
        expect(result.estimatedTurboCost).not.toBe(syntheticQuote);
        expect(result.estimatedTurboCost).toBeNull();
      }
    });
  });

  describe('calculateUploadCosts — real quotes pass through unchanged', () => {
    it('passes through a real Turbo quote and detects sufficient balance', async () => {
      mockTurboManager.isInitialized.mockReturnValue(true);
      mockTurboManager.getUploadCosts.mockResolvedValue({ winc: '2000000000' }); // 0.002 AR
      mockTurboManager.getBalance.mockResolvedValue({ winc: '5000000000' });

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      expect(result.estimatedTurboCost).toBe(0.002);
      expect(result.hasSufficientTurboBalance).toBe(true);
      expect(result.recommendedMethod).toBe('turbo'); // large file + balance
    });

    it('keeps the real quote when balance is insufficient (only the flag changes)', async () => {
      mockTurboManager.isInitialized.mockReturnValue(true);
      mockTurboManager.getUploadCosts.mockResolvedValue({ winc: '2000000000' });
      mockTurboManager.getBalance.mockResolvedValue({ winc: '1000' });

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      expect(result.estimatedTurboCost).toBe(0.002);
      expect(result.hasSufficientTurboBalance).toBe(false);
      expect(result.recommendedMethod).toBe('ar');
    });

    it('keeps the real quote when the balance lookup returns null', async () => {
      mockTurboManager.isInitialized.mockReturnValue(true);
      mockTurboManager.getUploadCosts.mockResolvedValue({ winc: '2000000000' });
      mockTurboManager.getBalance.mockResolvedValue(null);

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      expect(result.estimatedTurboCost).toBe(0.002);
      expect(result.hasSufficientTurboBalance).toBe(false);
    });
  });

  describe('internal AR placeholder (kept for shape compatibility only)', () => {
    it('keeps the 1-winston-per-byte placeholder field downstream code depends on', async () => {
      mockTurboManager.isInitialized.mockReturnValue(false);

      const result = await calculator.calculateUploadCosts(FILE_SIZE_5MB);

      // This value is an internal placeholder (NOT network pricing) — the UI
      // must never render it as a price. See MONEY-3 / MONEY-1.
      expect(result.estimatedCost).toBe(FILE_SIZE_5MB / 1e12);
    });
  });

  describe('free tier', () => {
    it('flags files under 100KB as free with Turbo', () => {
      expect(calculator.isFreeWithTurbo(100 * 1024 - 1)).toBe(true);
      expect(calculator.isFreeWithTurbo(100 * 1024)).toBe(false);
    });
  });
});
