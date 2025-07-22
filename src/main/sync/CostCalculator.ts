import { turboManager } from '../turbo-manager';

export class CostCalculator {
  private readonly TURBO_FREE_SIZE_LIMIT = 100 * 1024; // 100KB
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB for MVP
  private readonly FOLDER_BASE_COST = 0.000001; // Minimal cost for folder metadata

  async calculateUploadCosts(fileSize: number): Promise<{
    estimatedCost: number;
    estimatedTurboCost: number | null;
    recommendedMethod: 'ar' | 'turbo';
    hasSufficientTurboBalance: boolean;
  }> {
    // ArDrive uses ~1 winston per byte, convert to AR (1 AR = 1e12 winston)
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
        // Even if not initialized, show Turbo option with estimated cost
        // This allows users to see the option and get Turbo Credits if needed
        console.log('Turbo manager not initialized, using estimated cost...');
        
        // Rough estimate: Turbo is typically similar cost to AR but faster
        // We'll set it to a slightly higher cost to be conservative
        estimatedTurboCost = estimatedCost * 1.1; // 10% more than AR, already in AR units
        console.log(`Turbo estimated cost (not initialized): ${estimatedTurboCost} AR`);
        hasSufficientTurboBalance = false; // Can't have balance if not initialized
      }
    } catch (turboError) {
      console.warn('Failed to get Turbo cost estimate:', turboError);
      // Even on error, provide estimated cost so users see the option
      estimatedTurboCost = estimatedCost * 1.1; // Conservative estimate, already in AR
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

  isFileTooBig(fileSize: number): boolean {
    return fileSize > this.MAX_FILE_SIZE;
  }

  isFreeWithTurbo(fileSize: number): boolean {
    return fileSize < this.TURBO_FREE_SIZE_LIMIT;
  }

  formatCostInAR(cost: number): string {
    return cost.toFixed(6);
  }
}