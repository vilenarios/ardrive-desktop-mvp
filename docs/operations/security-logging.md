# Security Logging Guidelines

This document outlines secure logging practices to prevent sensitive information leakage.

## 🚫 Never Log These

### Critical - Never Log:
- Passwords (including length or partial passwords)
- Private keys or wallet data
- Seed phrases or mnemonics
- Session tokens or authentication data
- Full wallet addresses
- Personal user data

### High Risk - Avoid Logging:
- File contents or metadata
- User directory paths
- API keys or secrets
- Database connection strings

## ✅ Safe Logging Practices

### Use SecureLogger
```typescript
import SecureLogger from './secure-logger';

// Instead of:
console.log('Password length:', password.length); // ❌ NEVER

// Use:
SecureLogger.log('Authentication attempt initiated'); // ✅ SAFE
```

### Redact Addresses
```typescript
// Instead of:
console.log('Wallet address:', address); // ❌ EXPOSES FULL ADDRESS

// Use:
console.log('Wallet address:', SecureLogger.redactAddress(address)); // ✅ SAFE
// Output: "Wallet address: 1A2B...9Z8Y"
```

### Handle Objects Safely
```typescript
// Instead of:
console.log('User data:', userData); // ❌ MAY CONTAIN SENSITIVE DATA

// Use:
SecureLogger.log('User data processed:', userData); // ✅ AUTO-REDACTS
```

## 🔧 Implementation

### 1. Replace console.log
Replace all `console.log` statements with `SecureLogger.log`:

```typescript
// Before
console.log('Processing user:', user.address);

// After  
SecureLogger.log('Processing user:', user.address);
```

### 2. Production Logging
SecureLogger automatically disables logging in production:

```typescript
// This only logs in development
SecureLogger.debug('Debug info:', sensitiveData);
```

### 3. Error Handling
```typescript
try {
  // ... code
} catch (error) {
  // Safe error logging
  SecureLogger.error('Operation failed:', error.message);
  // Avoid logging the full error object which may contain sensitive data
}
```

## 🛡️ Patterns to Avoid

### Password Patterns
```typescript
// ❌ NEVER DO THESE:
console.log('Password length:', password.length);
console.log('First 4 chars:', password.substring(0, 4));
console.log('Password valid:', !!password);
console.log('Auth data:', { password, username });
```

### Key/Secret Patterns
```typescript
// ❌ NEVER DO THESE:
console.log('Private key loaded:', privateKey);
console.log('Seed phrase generated:', seedPhrase);
console.log('JWT token:', token);
console.log('API response:', apiResponse); // May contain keys
```

### Address Patterns
```typescript
// ❌ AVOID:
console.log('Full address:', walletAddress);

// ✅ PREFER:
console.log('Address:', SecureLogger.redactAddress(walletAddress));
```

## 🔍 Detection

### ESLint Rules (Recommended)
Add these rules to your `.eslintrc.js`:

```javascript
module.exports = {
  rules: {
    // Disallow console.log in favor of SecureLogger
    'no-console': 'error',
    
    // Custom rules (requires custom plugin)
    'security/no-sensitive-logging': 'error'
  }
};
```

### Pre-commit Hooks
Use grep patterns to catch sensitive logging:

```bash
# Check for sensitive patterns
git diff --cached | grep -E "(password|key|secret|token|mnemonic)" && exit 1
```

## 📝 Audit Checklist

Before committing, verify:

- [ ] No `console.log` statements with sensitive data
- [ ] All logging uses `SecureLogger` 
- [ ] Addresses are redacted with `redactAddress()`
- [ ] No password/key logging (even metadata like length)
- [ ] Error logs don't contain sensitive stack traces
- [ ] File paths don't reveal user directory structure

## 🚨 Security Incidents

If sensitive data was accidentally logged:

1. **Immediate**: Remove the logging statement
2. **Review**: Check all log files for the sensitive data
3. **Rotate**: Change any exposed credentials
4. **Report**: Document the incident for security review
5. **Prevent**: Add detection rules to prevent recurrence

## 📚 Additional Resources

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [Node.js Security Best Practices](https://nodejs.org/en/security/)