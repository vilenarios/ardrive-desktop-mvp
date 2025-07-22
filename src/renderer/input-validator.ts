/**
 * Client-side Input Validation Utility
 * 
 * Provides validation for user inputs in the renderer process before
 * sending them to the main process. This provides immediate user feedback
 * and prevents invalid data from reaching the backend.
 */

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ClientInputValidator {
  // Validation patterns
  private static readonly PATTERNS = {
    ARWEAVE_ADDRESS: /^[a-zA-Z0-9_-]{43}$/,
    DRIVE_ID: /^[a-zA-Z0-9_-]{43}$/,
    PROFILE_ID: /^[a-zA-Z0-9-]{36}$/,
    SAFE_STRING: /^[a-zA-Z0-9\s\-_.,!@#$%^&*()+=[\]{}|;':"<>?`~]*$/,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  };

  // Constraints
  private static readonly CONSTRAINTS = {
    MAX_STRING_LENGTH: 10000,
    MAX_FILENAME_LENGTH: 255,
    MIN_PASSWORD_LENGTH: 8,
    MAX_PASSWORD_LENGTH: 128,
    MAX_DRIVE_NAME_LENGTH: 100,
    MAX_PROFILE_NAME_LENGTH: 100,
    MIN_TURBO_AMOUNT: 0.000000000001,
    MAX_TURBO_AMOUNT: 1000000
  };

  /**
   * Validates a required string field
   */
  static validateRequiredString(
    value: string | undefined | null,
    fieldName: string,
    options: {
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
    } = {}
  ): { isValid: boolean; error?: string; value?: string } {
    const { minLength = 1, maxLength = this.CONSTRAINTS.MAX_STRING_LENGTH, pattern } = options;

    if (!value || typeof value !== 'string') {
      return { isValid: false, error: `${fieldName} is required` };
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { isValid: false, error: `${fieldName} cannot be empty` };
    }

    if (trimmed.length < minLength) {
      return { isValid: false, error: `${fieldName} must be at least ${minLength} characters long` };
    }

    if (trimmed.length > maxLength) {
      return { isValid: false, error: `${fieldName} cannot exceed ${maxLength} characters` };
    }

    if (pattern && !pattern.test(trimmed)) {
      return { isValid: false, error: `${fieldName} contains invalid characters` };
    }

    // XSS prevention
    if (trimmed.toLowerCase().includes('<script') || trimmed.toLowerCase().includes('javascript:')) {
      return { isValid: false, error: `${fieldName} contains potentially harmful content` };
    }

    return { isValid: true, value: trimmed };
  }

  /**
   * Validates a password field
   */
  static validatePassword(password: string | undefined | null): { isValid: boolean; error?: string; value?: string } {
    const result = this.validateRequiredString(password, 'Password', {
      minLength: this.CONSTRAINTS.MIN_PASSWORD_LENGTH,
      maxLength: this.CONSTRAINTS.MAX_PASSWORD_LENGTH
    });

    if (!result.isValid) {
      return result;
    }

    // Additional password strength checks
    const pwd = result.value!;
    
    if (pwd.length < this.CONSTRAINTS.MIN_PASSWORD_LENGTH) {
      return { isValid: false, error: `Password must be at least ${this.CONSTRAINTS.MIN_PASSWORD_LENGTH} characters long` };
    }

    // Optional: Add more sophisticated password strength validation
    // if (!/[A-Z]/.test(pwd)) {
    //   return { isValid: false, error: 'Password must contain at least one uppercase letter' };
    // }

    return { isValid: true, value: pwd };
  }

  /**
   * Validates a drive name
   */
  static validateDriveName(name: string | undefined | null): { isValid: boolean; error?: string; value?: string } {
    return this.validateRequiredString(name, 'Drive name', {
      minLength: 1,
      maxLength: this.CONSTRAINTS.MAX_DRIVE_NAME_LENGTH,
      pattern: this.PATTERNS.SAFE_STRING
    });
  }

  /**
   * Validates a profile name
   */
  static validateProfileName(name: string | undefined | null): { isValid: boolean; error?: string; value?: string } {
    return this.validateRequiredString(name, 'Profile name', {
      minLength: 1,
      maxLength: this.CONSTRAINTS.MAX_PROFILE_NAME_LENGTH,
      pattern: this.PATTERNS.SAFE_STRING
    });
  }

  /**
   * Validates a seed phrase
   */
  static validateSeedPhrase(seedPhrase: string | undefined | null): { isValid: boolean; error?: string; value?: string } {
    const result = this.validateRequiredString(seedPhrase, 'Seed phrase', {
      minLength: 20,
      maxLength: 500
    });

    if (!result.isValid) {
      return result;
    }

    const trimmed = result.value!;
    const words = trimmed.split(/\s+/);

    if (words.length !== 12 && words.length !== 24) {
      return { isValid: false, error: 'Seed phrase must contain exactly 12 or 24 words' };
    }

    // Validate each word contains only letters
    for (const word of words) {
      if (!/^[a-zA-Z]+$/.test(word)) {
        return { isValid: false, error: `Invalid word in seed phrase: "${word}". Only letters are allowed.` };
      }
    }

    return { isValid: true, value: trimmed };
  }

  /**
   * Validates a file path
   */
  static validateFilePath(path: string | undefined | null): { isValid: boolean; error?: string; value?: string } {
    const result = this.validateRequiredString(path, 'File path', {
      minLength: 1,
      maxLength: 4096
    });

    if (!result.isValid) {
      return result;
    }

    const trimmed = result.value!;

    // Check for dangerous path patterns
    if (trimmed.includes('..') || trimmed.includes('//') || trimmed.includes('\\\\')) {
      return { isValid: false, error: 'File path contains invalid characters' };
    }

    // Check for system paths (basic check)
    const dangerousPaths = ['/etc/', '/usr/', '/bin/', '/sbin/', '/root/', 'C:\\Windows\\', 'C:\\Program Files\\'];
    const lowerPath = trimmed.toLowerCase();
    
    for (const dangerous of dangerousPaths) {
      if (lowerPath.includes(dangerous.toLowerCase())) {
        return { isValid: false, error: 'Cannot access system directories' };
      }
    }

    return { isValid: true, value: trimmed };
  }

  /**
   * Validates a positive number
   */
  static validatePositiveNumber(
    value: number | string | undefined | null,
    fieldName: string,
    options: { min?: number; max?: number; integer?: boolean } = {}
  ): { isValid: boolean; error?: string; value?: number } {
    const { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = options;

    if (value === undefined || value === null) {
      return { isValid: false, error: `${fieldName} is required` };
    }

    let num: number;
    if (typeof value === 'string') {
      num = parseFloat(value);
    } else if (typeof value === 'number') {
      num = value;
    } else {
      return { isValid: false, error: `${fieldName} must be a valid number` };
    }

    if (isNaN(num) || !isFinite(num)) {
      return { isValid: false, error: `${fieldName} must be a valid number` };
    }

    if (num < min) {
      return { isValid: false, error: `${fieldName} must be at least ${min}` };
    }

    if (num > max) {
      return { isValid: false, error: `${fieldName} cannot exceed ${max}` };
    }

    if (integer && !Number.isInteger(num)) {
      return { isValid: false, error: `${fieldName} must be a whole number` };
    }

    return { isValid: true, value: num };
  }

  /**
   * Validates a Turbo amount
   */
  static validateTurboAmount(amount: number | string | undefined | null): { isValid: boolean; error?: string; value?: number } {
    return this.validatePositiveNumber(amount, 'Amount', {
      min: this.CONSTRAINTS.MIN_TURBO_AMOUNT,
      max: this.CONSTRAINTS.MAX_TURBO_AMOUNT
    });
  }

  /**
   * Validates an Arweave address
   */
  static validateArweaveAddress(address: string | undefined | null): { isValid: boolean; error?: string; value?: string } {
    const result = this.validateRequiredString(address, 'Address', {
      minLength: 43,
      maxLength: 43,
      pattern: this.PATTERNS.ARWEAVE_ADDRESS
    });

    if (!result.isValid) {
      return result;
    }

    if (!this.PATTERNS.ARWEAVE_ADDRESS.test(result.value!)) {
      return { isValid: false, error: 'Invalid Arweave address format' };
    }

    return result;
  }

  /**
   * Helper to validate multiple fields at once
   */
  static validateFields(
    fields: { [key: string]: any },
    validators: { [key: string]: (value: any) => { isValid: boolean; error?: string; value?: any } }
  ): { isValid: boolean; errors: { [key: string]: string }; values: { [key: string]: any } } {
    const errors: { [key: string]: string } = {};
    const values: { [key: string]: any } = {};
    let isValid = true;

    for (const [fieldName, validator] of Object.entries(validators)) {
      const result = validator(fields[fieldName]);
      if (!result.isValid) {
        errors[fieldName] = result.error!;
        isValid = false;
      } else {
        values[fieldName] = result.value;
      }
    }

    return { isValid, errors, values };
  }
}

export default ClientInputValidator;