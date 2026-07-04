// @vitest-environment node
//
// PRIV-7: unlocking an EXISTING private drive must accept whatever password the
// user provides — drives created by other ArDrive clients may use a password
// shorter than our 8-char NEW-password minimum, and were previously impossible
// to unlock because drive:unlock ran the new-password strength validator.
//
// The fix separates two contracts:
//   - validatePassword         → NEW password we mint (must keep the 8-char min)
//   - validateExistingPassword → EXISTING password we only derive/unlock with
//                                (no length policy; correctness is trial-decrypt)
import { describe, it, expect } from 'vitest';
import { InputValidator, ValidationError } from '../../../src/main/input-validator';

describe('InputValidator password contracts (PRIV-7)', () => {
  describe('validateExistingPassword — unlock/derive path', () => {
    it('accepts a short (<8 char) password from another client', () => {
      // The exact input the old validator rejected outright.
      expect(InputValidator.validateExistingPassword('abc')).toBe('abc');
      expect(InputValidator.validateExistingPassword('1')).toBe('1');
    });

    it('accepts a normal-length password too', () => {
      expect(InputValidator.validateExistingPassword('correct-horse')).toBe('correct-horse');
    });

    it('still rejects an empty password', () => {
      expect(() => InputValidator.validateExistingPassword('')).toThrow(ValidationError);
      expect(() => InputValidator.validateExistingPassword('   ')).toThrow(/cannot be empty/);
    });

    it('still rejects a non-string password', () => {
      expect(() => InputValidator.validateExistingPassword(undefined)).toThrow(ValidationError);
      expect(() => InputValidator.validateExistingPassword(12345678)).toThrow(/must be a string/);
    });

    it('caps absurdly long input as a basic abuse guard', () => {
      expect(() => InputValidator.validateExistingPassword('a'.repeat(200))).toThrow(/cannot exceed/);
    });
  });

  describe('validatePassword — new-password path is UNCHANGED', () => {
    it('still enforces the 8-char minimum for passwords we mint', () => {
      expect(() => InputValidator.validatePassword('abc')).toThrow(/at least 8 characters/);
      expect(() => InputValidator.validatePassword('short7!')).toThrow(/at least 8 characters/);
    });

    it('accepts a password that meets the minimum', () => {
      expect(InputValidator.validatePassword('longenough')).toBe('longenough');
    });
  });
});
