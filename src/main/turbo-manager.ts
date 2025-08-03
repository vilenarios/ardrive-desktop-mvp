import { ArweaveSigner, TurboFactory, TurboAuthenticatedClient, TurboUnauthenticatedClient, USD, EUR, GBP, CAD, AUD, JPY, INR, SGD, HKD, BRL } from '@ardrive/turbo-sdk';
import Arweave from 'arweave';
import { WalletInfo } from '../types';

export interface TurboBalance {
  winc: string;
  ar: string;
}

export interface TurboCosts {
  winc: string;
  adjustments?: any[];
}

export interface TurboUploadResult {
  id: string;
  owner: string;
  dataCaches?: string[];
  fastFinalityIndexes?: string[];
}

export class TurboManager {
  private authenticatedClient: TurboAuthenticatedClient | null = null;
  private unauthenticatedClient: TurboUnauthenticatedClient;
  private signer: ArweaveSigner | null = null;

  constructor() {
    this.unauthenticatedClient = TurboFactory.unauthenticated();
  }

  /**
   * Initialize Turbo with wallet authentication
   */
  async initialize(jwk: any): Promise<void> {
    try {
      this.signer = new ArweaveSigner(jwk);
      this.authenticatedClient = TurboFactory.authenticated({ signer: this.signer });
    } catch (error) {
      console.error('Failed to initialize Turbo:', error);
      throw new Error('Failed to initialize Turbo client');
    }
  }

  /**
   * Initialize Turbo with Ethereum private key
   */
  async initializeWithEthereumKey(ethereumPrivateKey: string): Promise<void> {
    try {
      const { EthereumSigner } = await import('@ardrive/turbo-sdk');
      const ethereumSigner = new EthereumSigner(ethereumPrivateKey);
      this.authenticatedClient = TurboFactory.authenticated({ signer: ethereumSigner });
      this.signer = ethereumSigner as any; // Type compatibility
    } catch (error) {
      console.error('Failed to initialize Turbo with Ethereum key:', error);
      throw new Error('Failed to initialize Turbo client with Ethereum key');
    }
  }

  /**
   * Check if Turbo is initialized with authentication
   */
  isInitialized(): boolean {
    return this.authenticatedClient !== null && this.signer !== null;
  }

  /**
   * Get Turbo Credits balance for the authenticated wallet
   */
  async getBalance(): Promise<TurboBalance> {
    if (!this.authenticatedClient) {
      throw new Error('Turbo not initialized. Call initialize() first.');
    }

    try {
      const { winc } = await this.authenticatedClient.getBalance();
      
      // Convert winc to AR for display (1 AR = 1e12 winc)
      const arBalance = (parseFloat(winc) / 1e12).toFixed(6);
      
      return {
        winc,
        ar: arBalance
      };
    } catch (error) {
      console.error('Failed to get Turbo balance:', error);
      throw new Error('Failed to get Turbo Credits balance');
    }
  }

  /**
   * Get upload costs in Turbo Credits for given byte size
   */
  async getUploadCosts(bytes: number): Promise<TurboCosts> {
    try {
      const [uploadCost] = await this.unauthenticatedClient.getUploadCosts({ bytes: [bytes] });
      return {
        winc: uploadCost.winc,
        adjustments: uploadCost.adjustments
      };
    } catch (error) {
      console.error('Failed to get upload costs:', error);
      throw new Error('Failed to get upload costs');
    }
  }

  /**
   * Get fiat estimate for bytes
   */
  async getFiatEstimate(byteCount: number, currency: string = 'usd'): Promise<any> {
    try {
      // Map currency string to proper type
      const currencyMap: { [key: string]: "usd" | "eur" | "gbp" | "cad" | "aud" | "jpy" | "inr" | "sgd" | "hkd" | "brl" } = {
        'usd': 'usd',
        'eur': 'eur', 
        'gbp': 'gbp',
        'cad': 'cad',
        'aud': 'aud',
        'jpy': 'jpy',
        'inr': 'inr',
        'sgd': 'sgd',
        'hkd': 'hkd',
        'brl': 'brl'
      };
      
      return await this.unauthenticatedClient.getFiatEstimateForBytes({
        byteCount,
        currency: currencyMap[currency.toLowerCase()] || 'usd'
      });
    } catch (error) {
      console.error('Failed to get fiat estimate:', error);
      throw new Error('Failed to get fiat estimate');
    }
  }

  /**
   * Upload data using Turbo Credits with progress tracking
   */
  async uploadData(
    data: Buffer, 
    tags?: any[], 
    onProgress?: (progress: { processedBytes: number; totalBytes: number }) => void
  ): Promise<TurboUploadResult> {
    if (!this.authenticatedClient) {
      throw new Error('Turbo not initialized. Call initialize() first.');
    }

    try {
      const result = await this.authenticatedClient.upload({
        data,
        dataItemOpts: {
          tags: tags || []
        },
        events: {
          onProgress: ({ totalBytes, processedBytes }) => {
            if (onProgress) {
              onProgress({ processedBytes, totalBytes });
            }
          },
          onError: (error) => {
            console.error('Turbo upload error:', error);
          },
          onSuccess: () => {
            console.log('Turbo upload successful');
          }
        }
      });

      return {
        id: result.id,
        owner: result.owner,
        dataCaches: result.dataCaches,
        fastFinalityIndexes: result.fastFinalityIndexes
      };
    } catch (error) {
      console.error('Failed to upload data with Turbo:', error);
      throw new Error('Failed to upload data with Turbo Credits');
    }
  }

  /**
   * Upload file using Turbo Credits
   */
  async uploadFile(
    fileStreamFactory: () => any,
    fileSizeFactory: () => number,
    tags?: any[]
  ): Promise<TurboUploadResult> {
    if (!this.authenticatedClient) {
      throw new Error('Turbo not initialized. Call initialize() first.');
    }

    try {
      const result = await this.authenticatedClient.uploadFile({
        fileStreamFactory,
        fileSizeFactory,
        dataItemOpts: {
          tags: tags || []
        }
      });

      return {
        id: result.id,
        owner: result.owner,
        dataCaches: result.dataCaches,
        fastFinalityIndexes: result.fastFinalityIndexes
      };
    } catch (error) {
      console.error('Failed to upload file with Turbo:', error);
      throw new Error('Failed to upload file with Turbo Credits');
    }
  }

  /**
   * Create checkout session for fiat top-up
   */
  async createCheckoutSession(amount: number, currency: string = 'USD'): Promise<any> {
    if (!this.authenticatedClient || !this.signer) {
      throw new Error('Turbo not initialized. Call initialize() first.');
    }

    try {
      console.log('TurboManager.createCheckoutSession called with:', { amount, currency, currencyType: typeof currency });
      
      const owner = await this.authenticatedClient.signer.getNativeAddress();
      console.log('Wallet owner address:', `${owner.slice(0,4)}...${owner.slice(-4)}`);
      
      // Ensure we have a valid currency string
      const safeCurrency = currency && typeof currency === 'string' ? currency.toUpperCase() : 'USD';
      console.log('Safe currency after validation:', safeCurrency);
      
      // Map currency string to proper Turbo SDK currency functions
      const currencyFunctionMap: { [key: string]: (amount: number) => any } = {
        'USD': USD,
        'EUR': EUR, 
        'GBP': GBP,
        'CAD': CAD,
        'AUD': AUD,
        'JPY': JPY,
        'INR': INR,
        'SGD': SGD,
        'HKD': HKD,
        'BRL': BRL
      };
      
      const currencyFunction = currencyFunctionMap[safeCurrency] || USD;
      console.log('Using currency function for:', safeCurrency);
      
      // Create proper currency object using SDK function
      const fiatAmount = currencyFunction(amount);
      console.log('Final fiat amount object:', { 
        amount: fiatAmount.amount, 
        type: fiatAmount.type,
        originalAmount: amount 
      });

      // Use the correct Turbo SDK format based on documentation
      console.log('Creating checkout session with SDK format...');
      
      // Try to add referrer/tracking information
      const checkoutParams: any = {
        amount: fiatAmount,
        owner: owner
      };

      // Attempt to add referrer tracking (experimental)
      // These parameters may or may not be supported by the SDK
      try {
        // Get app version from package.json
        const packageJson = await import('../../package.json');
        
        checkoutParams.referrer = 'ardrive-desktop';
        checkoutParams.source = 'ardrive-desktop-app';
        checkoutParams.metadata = {
          source: 'ardrive-desktop',
          app_version: packageJson.version || '1.0.0',
          platform: process.platform,
          timestamp: new Date().toISOString()
        };
        
        console.log('Added tracking metadata:', checkoutParams.metadata);
      } catch (e) {
        console.log('Could not add tracking metadata:', e);
        // Fallback without metadata
      }

      console.log('Creating checkout session with params:', checkoutParams);
      const result = await this.authenticatedClient.createCheckoutSession(checkoutParams);
      
      console.log('Checkout session created successfully:', result);
      
      // Log if any tracking information was preserved in the response
      // Use safe property access since these aren't in the official type
      const resultAny = result as any;
      if (resultAny.metadata || resultAny.referrer || resultAny.source) {
        console.log('Tracking info preserved in response:', {
          metadata: resultAny.metadata,
          referrer: resultAny.referrer,
          source: resultAny.source
        });
      } else {
        console.log('No tracking info found in response - may not be supported by SDK');
      }
      
      // Check if we have a valid URL to return
      if (!result.url) {
        console.error('No checkout URL received from Turbo SDK. Full response:', result);
        throw new Error('No checkout URL received from payment provider');
      }
      
      // Log the final checkout URL to see if tracking parameters are included
      console.log('Final checkout URL:', result.url);
      
      return result;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined
      });
      throw new Error('Failed to create checkout session');
    }
  }

  /**
   * Top up with AR tokens
   */
  async topUpWithTokens(tokenAmount: number, feeMultiplier: number = 1.0): Promise<any> {
    if (!this.authenticatedClient) {
      throw new Error('Turbo not initialized. Call initialize() first.');
    }

    try {
      // Convert AR to Winston (1 AR = 1e12 Winston)
      const winstonAmount = Math.floor(tokenAmount * 1e12);
      
      return await this.authenticatedClient.topUpWithTokens({
        tokenAmount: winstonAmount as any,
        feeMultiplier
      });
    } catch (error) {
      console.error('Failed to top up with tokens:', error);
      throw new Error('Failed to top up with AR tokens');
    }
  }

  /**
   * Reset the Turbo manager (for logout)
   */
  reset(): void {
    this.authenticatedClient = null;
    this.signer = null;
  }
}

// Export singleton instance
export const turboManager = new TurboManager();