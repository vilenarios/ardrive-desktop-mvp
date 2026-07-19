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
   * Validates a NEW password we are minting (wallet creation/import, private
   * drive creation). Enforces the 8-char minimum-strength policy.
   */
  static validatePassword(value: any, fieldName: string = 'password'): string {
    return this.validateString(value, fieldName, {
      required: true,
      minLength: this.CONSTRAINTS.MIN_PASSWORD_LENGTH,
      maxLength: this.CONSTRAINTS.MAX_PASSWORD_LENGTH
    });
  }

  /**
   * Validates a password supplied to UNLOCK / derive a key against EXISTING
   * encrypted data (e.g. a private drive created by another ArDrive client).
   *
   * PRIV-7: unlike validatePassword — which enforces our 8-char NEW-password
   * policy — this MUST accept whatever the user provides, because the drive's
   * password was minted elsewhere and may be shorter than our minimum. A drive
   * with a 3-char password created in another client could otherwise NEVER be
   * unlocked here. Unlock correctness comes from trial decryption downstream
   * (PRIV-2: derive the key and verify it decrypts the drive entity), NOT from
   * a length/strength check. We still reject empty / non-string input and cap
   * the length as a basic abuse guard.
   */
  static validateExistingPassword(value: any, fieldName: string = 'password'): string {
    return this.validateString(value, fieldName, {
      required: true,
      minLength: 0,
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
   * Validates a theme preference (DESIGN-2)
   */
  static validateThemePreference(value: any, fieldName: string = 'theme'): 'light' | 'dark' | 'system' {
    if (value !== 'light' && value !== 'dark' && value !== 'system') {
      throw new ValidationError(`${fieldName} must be one of 'light', 'dark', or 'system'`, fieldName);
    }
    return value;
  }

  /**
   * SEC-4: validates a strict boolean flag crossing the IPC boundary (e.g. the
   * "remember me on this device" consent toggle). Rejects any non-boolean so a
   * truthy/falsy coercion can never flip a security-relevant flag by accident.
   */
  static validateBoolean(value: any, fieldName: string = 'value'): boolean {
    if (typeof value !== 'boolean') {
      throw new ValidationError(`${fieldName} must be a boolean`, fieldName);
    }
    return value;
  }

  /**
   * Validates an Arweave gateway host (SYNC-17). Hostname only — no protocol,
   * path, port, or slashes (the app supplies https/443 itself). Rejects
   * anything outside DNS hostname characters so a malicious/malformed value can
   * never smuggle a protocol (`javascript:`), a path, or credentials into the
   * URLs / Arweave.init host we build from it.
   */
  static validateGatewayHost(value: any, fieldName: string = 'gatewayHost'): string {
    // Pre-trim so surrounding whitespace is forgiven (validateString applies the
    // pattern before its own trim). The pattern then rejects any embedded
    // whitespace, protocol, path, port, or slash.
    const trimmed = typeof value === 'string' ? value.trim() : value;
    return this.validateString(trimmed, fieldName, {
      minLength: 1,
      maxLength: 253,
      pattern: /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/
    });
  }

  /**
   * SYNC-23: validates the ORDERED DATA-fetch fallback gateway list. Each entry
   * must be a valid gateway host (same rules as validateGatewayHost). Empty
   * array is allowed (means "use the built-in default order"). Caps the count so
   * a caller can't set an unbounded failover list. Returns the trimmed hosts.
   */
  static validateGatewayHosts(value: any, fieldName: string = 'gatewayFallbacks'): string[] {
    if (!Array.isArray(value)) {
      throw new ValidationError(`${fieldName} must be an array of gateway hosts`, fieldName);
    }
    if (value.length > 8) {
      throw new ValidationError(`${fieldName} cannot list more than 8 gateways`, fieldName);
    }
    return value.map((host, i) =>
      this.validateGatewayHost(host, `${fieldName}[${i}]`)
    );
  }

  /**
   * CORE-10: validates the GraphQL page size (`config:set-gql-page-size`) —
   * the `first:` argument ardrive-core-js uses per paged GraphQL request.
   * Must be a positive integer no larger than the ar.io gateway max (1000);
   * core-js's own setGqlPageSize throws RangeError above that, so this
   * rejects it at the IPC boundary with a clear D-005 error instead of
   * letting that exception surface from a deeper call.
   */
  static validateGqlPageSize(value: any, fieldName: string = 'gqlPageSize'): number {
    return this.validatePositiveNumber(value, fieldName, { min: 1, max: 1000, integer: true });
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

    // Split into words and validate count.
    // UX-34: ardrive-core-js only ever derives an Arweave wallet from a
    // 12-word BIP-39 phrase (see wallet-manager-secure.ts / ardrive-core-js
    // SeedPhrase) — a 24-word phrase always failed at derivation, so this
    // validator no longer waves it through as "valid" up front.
    const words = seedPhrase.trim().split(/\s+/);

    if (words.length !== 12) {
      throw new ValidationError(`${fieldName} must contain exactly 12 words`, fieldName);
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