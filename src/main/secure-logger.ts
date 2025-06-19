/**
 * Secure Logger Utility
 * 
 * Prevents sensitive information from being logged to console or files.
 * Automatically redacts passwords, keys, addresses, and other sensitive data.
 */

class SecureLogger {
  private static readonly SENSITIVE_PATTERNS = [
    /password/i,
    /passphrase/i,
    /privatekey/i,
    /private_key/i,
    /seedphrase/i,
    /seed_phrase/i,
    /mnemonic/i,
    /secret/i,
    /token/i,
    /authorization/i,
    /bearer/i,
    /jwk/i,
    /wallet.*json/i
  ];

  private static readonly ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  /**
   * Redacts sensitive information from a string
   */
  private static redactSensitive(value: any): any {
    if (typeof value === 'string') {
      // Check if it's a wallet address and redact it
      if (this.ADDRESS_PATTERN.test(value)) {
        return value.length > 8 ? `${value.slice(0,4)}...${value.slice(-4)}` : '[REDACTED]';
      }
      
      // Check for other sensitive patterns
      const lowerValue = value.toLowerCase();
      for (const pattern of this.SENSITIVE_PATTERNS) {
        if (pattern.test(lowerValue)) {
          return '[REDACTED]';
        }
      }
      
      return value;
    } else if (typeof value === 'object' && value !== null) {
      const redacted: any = Array.isArray(value) ? [] : {};
      
      for (const [key, val] of Object.entries(value)) {
        // Check if the key name suggests sensitive data
        const sensitiveKey = this.SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
        
        if (sensitiveKey) {
          redacted[key] = '[REDACTED]';
        } else {
          redacted[key] = this.redactSensitive(val);
        }
      }
      
      return redacted;
    }
    
    return value;
  }

  /**
   * Safe logging that automatically redacts sensitive information
   */
  static log(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'production') {
      return; // No logging in production
    }

    const redactedMessage = this.redactSensitive(message);
    const redactedArgs = args.map(arg => this.redactSensitive(arg));
    
    console.log(redactedMessage, ...redactedArgs);
  }

  /**
   * Safe error logging that automatically redacts sensitive information
   */
  static error(message: string, ...args: any[]): void {
    const redactedMessage = this.redactSensitive(message);
    const redactedArgs = args.map(arg => this.redactSensitive(arg));
    
    console.error(redactedMessage, ...redactedArgs);
  }

  /**
   * Safe debug logging that automatically redacts sensitive information
   */
  static debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'production') {
      return; // No debug logging in production
    }

    const redactedMessage = this.redactSensitive(message);
    const redactedArgs = args.map(arg => this.redactSensitive(arg));
    
    console.debug('[DEBUG]', redactedMessage, ...redactedArgs);
  }

  /**
   * Safe warning logging that automatically redacts sensitive information
   */
  static warn(message: string, ...args: any[]): void {
    const redactedMessage = this.redactSensitive(message);
    const redactedArgs = args.map(arg => this.redactSensitive(arg));
    
    console.warn(redactedMessage, ...redactedArgs);
  }

  /**
   * Redacts an address to show only first and last 4 characters
   */
  static redactAddress(address: string): string {
    if (!address || address.length < 8) {
      return '[REDACTED]';
    }
    return `${address.slice(0,4)}...${address.slice(-4)}`;
  }

  /**
   * Completely redacts sensitive data
   */
  static redact(data: any): string {
    return '[REDACTED]';
  }
}

export default SecureLogger;