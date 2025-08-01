import * as fs from 'fs/promises';
import * as crypto from 'crypto';

/**
 * Verifies file stability by checking if the hash remains consistent over time
 */
export class FileHashVerifier {
  /**
   * Wait for a file to stabilize by verifying its hash doesn't change
   * @param filePath Path to the file
   * @param maxAttempts Maximum number of verification attempts
   * @param delayMs Delay between attempts in milliseconds
   * @returns The stable hash of the file
   */
  static async waitForStableHash(
    filePath: string, 
    maxAttempts: number = 5, 
    delayMs: number = 200
  ): Promise<string> {
    let previousHash: string | null = null;
    let stableCount = 0;
    const requiredStableChecks = 2; // Hash must be the same for 2 consecutive checks
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Calculate current hash
        const content = await fs.readFile(filePath);
        const currentHash = crypto.createHash('sha256').update(content).digest('hex');
        
        if (previousHash === currentHash) {
          stableCount++;
          if (stableCount >= requiredStableChecks) {
            console.log(`File hash stable after ${attempt + 1} attempts: ${currentHash.substring(0, 16)}...`);
            return currentHash;
          }
        } else {
          stableCount = 0; // Reset counter if hash changed
          if (previousHash) {
            console.log(`Hash changed during stabilization check ${attempt + 1}:`);
            console.log(`  Previous: ${previousHash.substring(0, 16)}...`);
            console.log(`  Current: ${currentHash.substring(0, 16)}...`);
          }
        }
        
        previousHash = currentHash;
        
        // Wait before next check (except on last attempt)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        console.error(`Error reading file during stabilization check:`, error);
        throw error;
      }
    }
    
    // If we get here, file didn't stabilize in time, return last hash
    console.warn(`File hash did not stabilize after ${maxAttempts} attempts, using last hash`);
    return previousHash!;
  }
  
  /**
   * Quick hash calculation without stability checks
   */
  static async calculateHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}