// @vitest-environment node
//
// CORE-10: core-js 4.2.0 added setGqlPageSize()/getGqlPageSize() (default
// 1000, the ar.io gateway max) so a consumer whose configured GraphQL
// gateway caps `first:` below 1000 (e.g. Goldsky) can lower it. These tests
// pin src/main/gql-page-size.ts, the bridge from the persisted config value
// (config-manager) into core-js's process-global setter:
//   - a valid configured value is applied as-is
//   - core-js's own setGqlPageSize is mocked (never the real thing — this is
//     a unit test, not an integration test against the real package) so we
//     can assert exactly what it was called with
//   - out-of-range / non-integer / wrong-type values are clamped/guarded to
//     the default BEFORE calling core-js, so a bad stored value can never
//     throw a RangeError out of app startup
//   - even if core-js's setter itself throws, the module recovers by
//     re-applying the default rather than letting the exception escape
import { describe, it, expect, beforeEach, vi } from 'vitest';

const setGqlPageSizeMock = vi.hoisted(() => vi.fn());
vi.mock('ardrive-core-js', () => ({
  setGqlPageSize: setGqlPageSizeMock,
}));

const getConfiguredGqlPageSizeMock = vi.hoisted(() => vi.fn());
vi.mock('@/main/config-manager', () => ({
  configManager: { getConfiguredGqlPageSize: getConfiguredGqlPageSizeMock },
}));

import { applyGqlPageSize, applyConfiguredGqlPageSize, DEFAULT_GQL_PAGE_SIZE } from '@/main/gql-page-size';

describe('CORE-10 applyGqlPageSize', () => {
  beforeEach(() => {
    setGqlPageSizeMock.mockReset();
    getConfiguredGqlPageSizeMock.mockReset();
  });

  it('DEFAULT_GQL_PAGE_SIZE is the ar.io gateway max (1000)', () => {
    expect(DEFAULT_GQL_PAGE_SIZE).toBe(1000);
  });

  it('applies a valid configured value as-is', () => {
    const result = applyGqlPageSize(100);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(100);
    expect(result).toBe(100);
  });

  it('applies the max (1000) as-is', () => {
    const result = applyGqlPageSize(1000);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(1000);
    expect(result).toBe(1000);
  });

  it('applies the min (1) as-is', () => {
    const result = applyGqlPageSize(1);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(1);
    expect(result).toBe(1);
  });

  it('falls back to the default when unset (undefined) — no throw, no warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = applyGqlPageSize(undefined);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('guards a zero/negative value: clamps to default before ever calling core-js', () => {
    const result = applyGqlPageSize(0);
    expect(setGqlPageSizeMock).toHaveBeenCalledTimes(1);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
  });

  it('guards an out-of-range value (2000 > 1000 ar.io max): clamps to default', () => {
    const result = applyGqlPageSize(2000);
    expect(setGqlPageSizeMock).toHaveBeenCalledTimes(1);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
  });

  it('guards a non-integer value: clamps to default', () => {
    const result = applyGqlPageSize(3.5);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
  });

  it('guards a non-number value (string): clamps to default', () => {
    const result = applyGqlPageSize('100' as unknown);
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
  });

  it('logs a warning for a genuinely-bad (not just unset) stored value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyGqlPageSize(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('recovers if core-js itself throws for the resolved value: re-applies the default and never throws out', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setGqlPageSizeMock.mockImplementationOnce(() => {
      throw new RangeError('GraphQL page size must be an integer in [1, 1000], got: 500');
    });

    let result: number | undefined;
    expect(() => {
      result = applyGqlPageSize(500);
    }).not.toThrow();

    expect(setGqlPageSizeMock).toHaveBeenCalledTimes(2);
    expect(setGqlPageSizeMock).toHaveBeenNthCalledWith(1, 500);
    expect(setGqlPageSizeMock).toHaveBeenNthCalledWith(2, DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
    errorSpy.mockRestore();
  });
});

describe('CORE-10 applyConfiguredGqlPageSize', () => {
  beforeEach(() => {
    setGqlPageSizeMock.mockReset();
    getConfiguredGqlPageSizeMock.mockReset();
  });

  it('reads the persisted configured value and applies it to core-js', () => {
    getConfiguredGqlPageSizeMock.mockReturnValue(250);
    const result = applyConfiguredGqlPageSize();
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(250);
    expect(result).toBe(250);
  });

  it('applies the default (1000) when nothing is configured', () => {
    getConfiguredGqlPageSizeMock.mockReturnValue(undefined);
    const result = applyConfiguredGqlPageSize();
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
    expect(result).toBe(DEFAULT_GQL_PAGE_SIZE);
  });

  it('guards a corrupt persisted value (e.g. hand-edited config.json) without throwing', () => {
    getConfiguredGqlPageSizeMock.mockReturnValue(-5);
    expect(() => applyConfiguredGqlPageSize()).not.toThrow();
    expect(setGqlPageSizeMock).toHaveBeenCalledWith(DEFAULT_GQL_PAGE_SIZE);
  });
});
