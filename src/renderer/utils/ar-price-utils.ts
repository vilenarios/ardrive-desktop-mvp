// Simple AR to USD price conversion utility
// In production, this would fetch from a price API like CoinGecko or Binance

interface ArPriceData {
  usd: number;
  lastUpdated: Date;
}

let cachedPrice: ArPriceData | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Mock AR price - in production this would be fetched from an API
const MOCK_AR_PRICE_USD = 6.50; // $6.50 per AR token

export async function getArPriceInUSD(): Promise<number> {
  // Check cache first
  if (cachedPrice && (Date.now() - cachedPrice.lastUpdated.getTime()) < CACHE_DURATION) {
    return cachedPrice.usd;
  }

  try {
    // In production, replace with actual API call:
    // const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd');
    // const data = await response.json();
    // const price = data.arweave.usd;
    
    const price = MOCK_AR_PRICE_USD;
    
    cachedPrice = {
      usd: price,
      lastUpdated: new Date()
    };
    
    return price;
  } catch (error) {
    console.error('Failed to fetch AR price:', error);
    // Return last known price or default
    return cachedPrice?.usd || MOCK_AR_PRICE_USD;
  }
}

export function formatArToUSD(arAmount: number, arPriceUSD: number): string {
  const usdValue = arAmount * arPriceUSD;
  
  if (usdValue < 0.01) {
    return '<$0.01';
  } else if (usdValue < 1) {
    return `$${usdValue.toFixed(2)}`;
  } else {
    return `$${usdValue.toFixed(2)}`;
  }
}

export function formatWincToUSD(wincAmount: string | number, arPriceUSD: number): string {
  const winc = typeof wincAmount === 'string' ? parseFloat(wincAmount) : wincAmount;
  const arAmount = winc / 1e12; // Convert winc to AR
  return formatArToUSD(arAmount, arPriceUSD);
}

// Format Turbo credits (which are in AR equivalent) to USD
export function formatTurboCreditsToUSD(credits: number, arPriceUSD: number): string {
  return formatArToUSD(credits, arPriceUSD);
}

// Get upload cost estimate in USD
export function getUploadCostInUSD(bytes: number, arPriceUSD: number): string {
  // Rough estimate: 1 byte ≈ 1 winston
  const winstonCost = bytes;
  const arCost = winstonCost / 1e12;
  return formatArToUSD(arCost, arPriceUSD);
}