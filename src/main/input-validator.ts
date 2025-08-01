/**
 * Comprehensive Input Validation Utility
 * 
 * Provides robust validation for all user inputs to prevent:
 * - Injection attacks
 * - Path traversal attacks  
 * - Invalid data that could crash the application
 * - Malformed inputs that could corrupt data
 */

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class InputValidator {
  // Common validation patterns
  private static readonly PATTERNS = {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    ARWEAVE_ADDRESS: /^[a-zA-Z0-9_-]{43}$/,
    DRIVE_ID: /^[a-zA-Z0-9_-]{43}$/,
    PROFILE_ID: /^[a-zA-Z0-9-]{36}$/,
    HEX_COLOR: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
    // eslint-disable-next-line no-control-regex
    FILE_PATH: /^[^<>:"|?*\x00-\x1f\x80-\x9f]*$/,
    SAFE_STRING: /^[a-zA-Z0-9\s\-_.,!@#$%^&*()+=[\]{}|;':"<>?`~]*$/
  };

  // Security constraints
  private static readonly CONSTRAINTS = {
    MAX_STRING_LENGTH: 10000,
    MAX_FILENAME_LENGTH: 255,
    MAX_PATH_LENGTH: 4096,
    MIN_PASSWORD_LENGTH: 8,
    MAX_PASSWORD_LENGTH: 128,
    MAX_DRIVE_NAME_LENGTH: 100,
    MAX_PROFILE_NAME_LENGTH: 100,
    MIN_TURBO_AMOUNT: 0.000000000001, // 1 Winston
    MAX_TURBO_AMOUNT: 1000000 // 1M AR
  };

  /**
   * Validates a string parameter
   */
  static validateString(
    value: any, 
    fieldName: string, 
    options: {
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
      allowEmpty?: boolean;
    } = {}
  ): string {
    const { required = true, minLength = 0, maxLength = this.CONSTRAINTS.MAX_STRING_LENGTH, pattern, allowEmpty = false } = options;

    // Type check
    if (typeof value !== 'string') {
      if (required) {
        throw new ValidationError(`${fieldName} must be a string`, fieldName);
      }
      return '';
    }

    // Empty check
    if (!allowEmpty && value.trim().length === 0) {
      if (required) {
        throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
      }
      return '';
    }

    // Length validation
    if (value.length < minLength) {
      throw new ValidationError(`${fieldName} must be at least ${minLength} characters long`, fieldName);
    }

    if (value.length > maxLength) {
      throw new ValidationError(`${fieldName} cannot exceed ${maxLength} characters`, fieldName);
    }

    // Pattern validation
    if (pattern && !pattern.test(value)) {
      throw new ValidationError(`${fieldName} contains invalid characters`, fieldName);
    }

    // XSS prevention - basic check for script tags
    if (value.toLowerCase().includes('<script') || value.toLowerCase().includes('javascript:')) {
      throw new ValidationError(`${fieldName} contains potentially malicious content`, fieldName);
    }

    return value.trim();
  }

  /**
   * Validates a password
   */
  static validatePassword(value: any, fieldName: string = 'password'): string {
    return this.validateString(value, fieldName, {
      required: true,
      minLength: this.CONSTRAINTS.MIN_PASSWORD_LENGTH,
      maxLength: this.CONSTRAINTS.MAX_PASSWORD_LENGTH
    });
  }

  /**
   * Validates an Arweave address
   */
  static validateArweaveAddress(value: any, fieldName: string = 'address'): string {
    const address = this.validateString(value, fieldName, {
      required: true,
      pattern: this.PATTERNS.ARWEAVE_ADDRESS,
      minLength: 43,
      maxLength: 43
    });

    if (!this.PATTERNS.ARWEAVE_ADDRESS.test(address)) {
      throw new ValidationError(`${fieldName} is not a valid Arweave address`, fieldName);
    }

    return address;
  }

  /**
   * Validates a drive ID (UUID format)
   */
  static validateDriveId(value: any, fieldName: string = 'driveId'): string {
    const driveId = this.validateString(value, fieldName, {
      required: true,
      pattern: this.PATTERNS.PROFILE_ID, // Same UUID pattern as profile ID
      minLength: 36,
      maxLength: 36
    });

    if (!this.PATTERNS.PROFILE_ID.test(driveId)) {
      throw new ValidationError(`${fieldName} is not a valid drive ID (must be UUID format)`, fieldName);
    }

    return driveId;
  }

  /**
   * Validates an entity ID (ArDrive entity ID format - UUID)
   */
  static validateEntityId(value: any, fieldName: string = 'entityId'): string {
    const entityId = this.validateString(value, fieldName, {
      required: true,
      minLength: 36,
      maxLength: 36
    });

    // ArDrive entity IDs are UUIDs (36 characters with dashes)
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(entityId)) {
      throw new ValidationError(`${fieldName} is not a valid entity ID format (expected UUID)`, fieldName);
    }

    return entityId;
  }

  /**
   * Validates a profile ID (UUID format)
   */
  static validateProfileId(value: any, fieldName: string = 'profileId'): string {
    const profileId = this.validateString(value, fieldName, {
      required: true,
      pattern: this.PATTERNS.PROFILE_ID,
      minLength: 36,
      maxLength: 36
    });

    if (!this.PATTERNS.PROFILE_ID.test(profileId)) {
      throw new ValidationError(`${fieldName} is not a valid profile ID`, fieldName);
    }

    return profileId;
  }

  /**
   * Validates a file path
   */
  static validateFilePath(value: any, fieldName: string = 'filePath'): string {
    const filePath = this.validateString(value, fieldName, {
      required: true,
      maxLength: this.CONSTRAINTS.MAX_PATH_LENGTH
    });

    // Check for path traversal attempts
    if (filePath.includes('..') || filePath.includes('//') || filePath.includes('\\\\')) {
      throw new ValidationError(`${fieldName} contains invalid path characters`, fieldName);
    }

    // Check for dangerous path patterns
    const dangerousPatterns = ['/etc/', '/usr/', '/bin/', '/sbin/', '/root/', 'C:\\Windows\\', 'C:\\Program Files\\'];
    const lowerPath = filePath.toLowerCase();
    
    for (const pattern of dangerousPatterns) {
      if (lowerPath.includes(pattern.toLowerCase())) {
        throw new ValidationError(`${fieldName} references a restricted system path`, fieldName);
      }
    }

    return filePath;
  }

  /**
   * Validates a drive name
   */
  static validateDriveName(value: any, fieldName: string = 'driveName'): string {
    return this.validateString(value, fieldName, {
      required: true,
      minLength: 1,
      maxLength: this.CONSTRAINTS.MAX_DRIVE_NAME_LENGTH,
      pattern: this.PATTERNS.SAFE_STRING
    });
  }

  /**
   * Validates a profile name
   */
  static validateProfileName(value: any, fieldName: string = 'profileName'): string {
    return this.validateString(value, fieldName, {
      required: true,
      minLength: 1,
      maxLength: this.CONSTRAINTS.MAX_PROFILE_NAME_LENGTH,
      pattern: this.PATTERNS.SAFE_STRING
    });
  }

  /**
   * Validates a drive privacy setting
   */
  static validateDrivePrivacy(value: any, fieldName: string = 'privacy'): 'public' | 'private' {
    if (value !== 'public' && value !== 'private') {
      throw new ValidationError(`${fieldName} must be either 'public' or 'private'`, fieldName);
    }
    return value;
  }

  /**
   * Validates a positive number
   */
  static validatePositiveNumber(
    value: any, 
    fieldName: string, 
    options: { min?: number; max?: number; integer?: boolean } = {}
  ): number {
    const { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = options;

    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(`${fieldName} must be a valid number`, fieldName);
    }

    if (value < min) {
      throw new ValidationError(`${fieldName} must be at least ${min}`, fieldName);
    }

    if (value > max) {
      throw new ValidationError(`${fieldName} cannot exceed ${max}`, fieldName);
    }

    if (integer && !Number.isInteger(value)) {
      throw new ValidationError(`${fieldName} must be an integer`, fieldName);
    }

    return value;
  }

  /**
   * Validates a Turbo amount
   */
  static validateTurboAmount(value: any, fieldName: string = 'amount'): number {
    return this.validatePositiveNumber(value, fieldName, {
      min: this.CONSTRAINTS.MIN_TURBO_AMOUNT,
      max: this.CONSTRAINTS.MAX_TURBO_AMOUNT
    });
  }

  /**
   * Validates a seed phrase
   */
  static validateSeedPhrase(value: any, fieldName: string = 'seedPhrase'): string {
    const seedPhrase = this.validateString(value, fieldName, {
      required: true,
      minLength: 20, // Rough minimum for meaningful seed phrase
      maxLength: 500  // Reasonable maximum
    });

    // Split into words and validate count
    const words = seedPhrase.trim().split(/\s+/);
    
    if (words.length !== 12 && words.length !== 24) {
      throw new ValidationError(`${fieldName} must contain exactly 12 or 24 words`, fieldName);
    }

    // Basic word validation - only alphanumeric characters
    for (const word of words) {
      if (!/^[a-zA-Z]+$/.test(word)) {
        throw new ValidationError(`${fieldName} contains invalid characters in word: ${word}`, fieldName);
      }
    }

    return seedPhrase;
  }

  /**
   * Validates an object has required properties
   */
  static validateRequiredProperties(obj: any, requiredProps: string[], objectName: string = 'object'): void {
    if (!obj || typeof obj !== 'object') {
      throw new ValidationError(`${objectName} must be a valid object`);
    }

    for (const prop of requiredProps) {
      if (!(prop in obj) || obj[prop] === undefined || obj[prop] === null) {
        throw new ValidationError(`${objectName} is missing required property: ${prop}`, prop);
      }
    }
  }

  /**
   * Sanitizes a string for safe logging
   */
  static sanitizeForLogging(value: string, maxLength: number = 100): string {
    if (!value) return '[empty]';
    
    // Remove potentially sensitive patterns
    let sanitized = value.replace(/password|secret|key|token/gi, '[REDACTED]');
    
    // Truncate if too long
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '...';
    }
    
    return sanitized;
  }
}

export default InputValidator;