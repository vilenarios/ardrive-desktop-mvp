import { turboManager } from '../turbo-manager';
import { TURBO_FREE_SIZE_LIMIT } from '../../utils/turbo-utils';
import { MAX_SYNC_FILE_SIZE_BYTES } from './constants';

export class CostCalculator {
  private readonly FOLDER_BASE_COST = 0.000001; // Minimal cost for folder metadata

  async calculateUploadCosts(fileSize: number): Promise<{
    estimatedCost: number;
    estimatedTurboCost: number | null;
    recommendedMethod: 'ar' | 'turbo';
    hasSufficientTurboBalance: boolean;
  }> {
    // INTERNAL PLACEHOLDER ONLY (1 winston per byte, converted to AR).
    // This is NOT network pricing and excludes the community tip — it exists
    // because downstream code (sync-manager, DB rows) depends on the field's
    // shape. It must never be rendered to the user as a real AR quote
    // (MONEY-3); the AR payment display is being removed entirely (MONEY-1).
    const estimatedCostWinc = fileSize; // winston
    const estimatedCost = estimatedCostWinc / 1e12; // Convert to AR
    
    let estimatedTurboCost: number | null = null;
    let recommendedMethod: 'ar' | 'turbo' = 'ar';
    let hasSufficientTurboBalance = false;

    // Always try to get Turbo cost and check balance - this enables the option in UI
    try {
      if (turboManager.isInitialized()) {
        console.log('Turbo manager is initialized, getting cost estimate...');
        const turboCosts = await turboManager.getUploadCosts(fileSize);
        estimatedTurboCost = parseFloat(turboCosts.winc) / 1e12; // Convert winc to AR equivalent
        console.log(`Turbo cost calculated: ${estimatedTurboCost} AR`);
        
        // Check if user has sufficient Turbo balance
        const turboBalance = await turboManager.getBalance();
        const requiredWinc = turboCosts.winc;
        
        if (turboBalance && parseFloat(turboBalance.winc) >= parseFloat(requiredWinc)) {
          hasSufficientTurboBalance = true;
          console.log('User has sufficient Turbo balance for upload');
        } else {
          const balanceInAR = turboBalance ? parseFloat(turboBalance.winc) / 1e12 : 0;
          console.log(`Insufficient Turbo balance: ${balanceInAR} AR < ${estimatedTurboCost} AR`);
          hasSufficientTurboBalance = false;
        }
        
        // Recommend Turbo for files > 1MB or if significantly cheaper (and user has balance)
        const isLargeFile = fileSize > 1024 * 1024;
        const isCheaper = estimatedTurboCost < estimatedCost * 0.9; // 10% cheaper
        
        if (hasSufficientTurboBalance && (isLargeFile || isCheaper)) {
          recommendedMethod = 'turbo';
          console.log('Recommending Turbo due to:', { isLargeFile, isCheaper, hasSufficientTurboBalance });
        }
      } else {
        // No real quote available. Do NOT fabricate one — a synthetic
        // `estimatedCost * 1.1` used to be displayed as if it were a real
        // Turbo quote (MONEY-3). null means "estimate unavailable" and the
        // UI must render it as such.
        console.log('Turbo manager not initialized, no Turbo quote available');
        estimatedTurboCost = null;
        hasSufficientTurboBalance = false; // Can't have balance if not initialized
      }
    } catch (turboError) {
      console.warn('Failed to get Turbo cost estimate:', turboError);
      // Quote fetch failed — report "unavailable" (null), never a made-up number
      estimatedTurboCost = null;
      hasSufficientTurboBalance = false;
    }

    return {
      estimatedCost,
      estimatedTurboCost,
      recommendedMethod,
      hasSufficientTurboBalance
    };
  }

  getFolderCost(): number {
    return this.FOLDER_BASE_COST;
  }

  // SYNC-6: the beta upload cap. Single source = MAX_SYNC_FILE_SIZE_BYTES so the
  // check and every "too big" message the sync engine surfaces stay in lock-step.
  isFileTooBig(fileSize: number): boolean {
    return fileSize > MAX_SYNC_FILE_SIZE_BYTES;
  }

  isFreeWithTurbo(fileSize: number): boolean {
    // `<=`: a file of exactly the limit is free (matches "limit" semantics and
    // main.ts). Standardized in MONEY-14 — was `<`, causing a boundary defect.
    return fileSize <= TURBO_FREE_SIZE_LIMIT;
  }

  formatCostInAR(cost: number): string {
    return cost.toFixed(6);
  }
}