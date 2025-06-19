import { ARIO, ANT } from '@ar.io/sdk';

export interface ArNSProfile {
  name: string | null;
  avatar: string | null;
}

// Cache for ArNS data to minimize API calls
const arnsCache = new Map<
  string,
  {
    primaryName?: string;
    logo?: string;
    timestamp: number;
  }
>();

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if address is valid Arweave transaction ID
 */
function checkValidAddress(address: string): boolean {
  return /^[a-zA-Z0-9_-]{43}$/.test(address);
}

export class ArNSService {
  private ario = ARIO.mainnet();

  constructor() {
    // AR.IO SDK initialized with mainnet
  }

  /**
   * Get primary ArNS name for a wallet address
   */
  async getPrimaryNameForAddress(address: string): Promise<string | null> {
    try {
      // Check cache first
      const cached = arnsCache.get(address);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION && cached.primaryName !== undefined) {
        return cached.primaryName || null;
      }

      console.log('Fetching primary ArNS name for address:', `${address.slice(0,4)}...${address.slice(-4)}`);

      // Create a timeout promise
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 3000); // 3 second timeout
      });

      // Race between the API call and timeout
      const primaryName = await Promise.race([
        this.ario.getPrimaryName({ address }),
        timeoutPromise
      ]);

      if (primaryName && primaryName.name) {
        console.log('Found primary name:', primaryName.name);
        
        // Update cache
        arnsCache.set(address, {
          ...cached,
          primaryName: primaryName.name,
          timestamp: Date.now(),
        });
        return primaryName.name;
      }

      // Cache negative result
      arnsCache.set(address, {
        ...cached,
        primaryName: '',
        timestamp: Date.now(),
      });
      return null;
    } catch (error) {
      console.error('Error fetching primary ArNS name:', error);
      return null;
    }
  }

  /**
   * Get ArNS record details including logo
   */
  async getArNSRecord(name: string): Promise<{ processId: string | null; logo: string | null }> {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<{ processId: string | null; logo: string | null }>((resolve) => {
        setTimeout(() => resolve({ processId: null, logo: null }), 3000); // 3 second timeout
      });

      // Wrap the entire operation in a promise
      const recordPromise = (async () => {
        // Get the ArNS record
        const record = await this.ario.getArNSRecord({ name });

        console.log('ArNS Debug - Record for', name, ':', record);

        if (record && record.processId) {
          // Initialize ANT client for this record
          const ant = ANT.init({ processId: record.processId });

          console.log('ArNS Debug - ANT initialized for processId:', record.processId);

          // Get the logo transaction ID
          const logoTxId = await ant.getLogo();

          console.log('ArNS Debug - Logo TxId for', name, ':', logoTxId);

          if (logoTxId && checkValidAddress(logoTxId)) {
            console.log('ArNS Debug - Valid logo found:', logoTxId);
            return {
              processId: record.processId,
              logo: logoTxId,
            };
          }

          console.log('ArNS Debug - No valid logo found for', name);
          return {
            processId: record.processId,
            logo: null,
          };
        }

        console.log('ArNS Debug - No record or processId found for', name);
        return { processId: null, logo: null };
      })();

      // Race between the API calls and timeout
      return await Promise.race([recordPromise, timeoutPromise]);
    } catch (error) {
      console.error('Error fetching ArNS record for', name, ':', error);
      return { processId: null, logo: null };
    }
  }

  /**
   * Get complete ArNS profile data for a wallet address
   */
  async getArNSProfile(address: string): Promise<ArNSProfile> {
    try {
      // First get the primary name
      const primaryName = await this.getPrimaryNameForAddress(address);

      console.log('ArNS Debug - Primary name for', `${address.slice(0,4)}...${address.slice(-4)}`, ':', primaryName);

      if (!primaryName) {
        return { name: null, avatar: null };
      }

      // Check cache for logo
      const cached = arnsCache.get(address);
      if (cached && cached.logo !== undefined && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('ArNS Debug - Using cached logo for', primaryName, ':', cached.logo);
        return { 
          name: primaryName, 
          avatar: cached.logo ? `https://ardrive.net/${cached.logo}` : null 
        };
      }

      // Get the ArNS record details including logo
      const { logo } = await this.getArNSRecord(primaryName);

      console.log('ArNS Debug - Fetched logo for', primaryName, ':', logo);

      // Update cache with logo
      arnsCache.set(address, {
        primaryName,
        logo: logo || '',
        timestamp: Date.now(),
      });

      return { 
        name: primaryName, 
        avatar: logo ? `https://ardrive.net/${logo}` : null 
      };
    } catch (error) {
      console.error('Error fetching ArNS profile:', error);
      return { name: null, avatar: null };
    }
  }

  clearCache() {
    arnsCache.clear();
  }
}

// Singleton instance
export const arnsService = new ArNSService();